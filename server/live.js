const { WebSocket, WebSocketServer } = require('ws');
const A = require('./auth.js');
const { LessonBoards } = require('./board.js');

function create(server, dependencies) {
  const { auth, repository, logger } = dependencies;
  const wss = new WebSocketServer({ noServer: true });
  const roomsByLesson = new Map();
  const boards = new LessonBoards(repository, logger);

  function join(lessonId, socket) {
    if (!roomsByLesson.has(lessonId)) roomsByLesson.set(lessonId, new Set());
    roomsByLesson.get(lessonId).add(socket);
  }
  function leave(lessonId, socket) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    room.delete(socket);
    if (!room.size) {
      roomsByLesson.delete(lessonId);
      // Последний вышел — дописываем доску и освобождаем память.
      void boards.release(lessonId).catch(() => undefined);
    }
  }

  function broadcast(lessonId, payload, exclude) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const message = JSON.stringify(payload);
    room.forEach(client => {
      if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  /**
   * Правки доски. Роль не проверяем: и репетитор, и ученик занятия рисуют на
   * общем холсте — право доступа уже подтверждено при upgrade.
   */
  async function boardUpdate(socket, message) {
    const accepted = await boards.apply(socket.lessonId, message.elements);
    if (!accepted.length) return;
    broadcast(socket.lessonId, {
      type:'board_update', lessonId:socket.lessonId, elements:accepted,
      senderRole:socket.role,
    }, socket);
  }

  /** Курсор соседа. Живёт только в эфире: в сцену не пишется и не хранится. */
  function boardPointer(socket, message) {
    const point = message && message.pointer;
    const x = Number(point && point.x);
    const y = Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    broadcast(socket.lessonId, {
      type:'board_pointer', lessonId:socket.lessonId,
      id:socket.participantId, name:socket.userName, role:socket.role,
      pointer:{ x, y }, button:message.button === 'down' ? 'down' : 'up',
      selected:Array.isArray(message.selected) ? message.selected.slice(0, 200) : [],
    }, socket);
  }

  async function sendBoard(socket) {
    const elements = await boards.elements(socket.lessonId);
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type:'board_snapshot', lessonId:socket.lessonId, elements,
    }));
  }
  async function snapshotOf(lessonId, studentId) {
    const state = await repository.fullState();
    const lesson = state.lessons.find(item => item.id === lessonId);
    if (!lesson) return null;
    const taskIds = new Set(lesson.taskIds || []);
    const attempts = state.attempts
      .filter(item => item.lessonId === lessonId && item.studentId === studentId && taskIds.has(item.taskId))
      .map(item => ({ id: item.id, taskId: item.taskId, code: item.code, answer: item.answer,
        tries: item.tries, isCorrect: item.isCorrect, activeSeconds: item.activeSeconds, status: item.status }));
    return { lessonId, studentId, attempts, at: new Date().toISOString() };
  }
  async function push(lessonId, studentId) {
    if (!lessonId) return;
    const room = roomsByLesson.get(lessonId);
    if (!room?.size) return;
    const payload = await snapshotOf(lessonId, studentId);
    if (!payload) return;
    const message = JSON.stringify({ type: 'snapshot', ...payload });
    room.forEach(socket => {
      const allowed = socket.role === 'tutor' || (socket.role === 'student' && socket.studentId === studentId);
      if (socket.readyState === WebSocket.OPEN && allowed) socket.send(message);
    });
  }
  function presence(lessonId) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const who = [...room].map(socket => ({ role: socket.role, name: socket.userName }));
    const message = JSON.stringify({ type: 'presence', lessonId, who });
    room.forEach(socket => { if (socket.readyState === WebSocket.OPEN) socket.send(message); });
  }

  function invalidate(lessonId, reason = 'lesson_changed') {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const message = JSON.stringify({
      type: 'state_invalidated',
      lessonId,
      reason,
      at: new Date().toISOString(),
    });
    room.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    });
  }

  function sendToStudent(lessonId, studentId, payload) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const message = JSON.stringify(payload);
    room.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.role === 'student' && client.studentId === studentId) {
        client.send(message);
      }
    });
  }

  function sendToTutors(lessonId, payload, sender) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const message = JSON.stringify(payload);
    room.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN && client.role === 'tutor') {
        client.send(message);
      }
    });
  }

  function normalizedPoints(value, limit = 48) {
    return Array.isArray(value) ? value.slice(0, limit)
      .map(point => ({ x:Number(point && point.x), y:Number(point && point.y) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) : [];
  }

  async function attemptTarget(socket, message) {
    const attemptId = String(message.attemptId || '');
    if (!attemptId) return null;
    if (!socket.attemptTargets) socket.attemptTargets = new Map();
    if (!socket.attemptTargets.has(attemptId)) {
      socket.attemptTargets.set(attemptId, Promise.resolve(repository.findAttempt(attemptId)).then(attempt => {
        if (!attempt || attempt.lesson_id !== socket.lessonId) return null;
        if (socket.role === 'student' && attempt.student_id !== socket.studentId) return null;
        return { attemptId, studentId:attempt.student_id, taskId:attempt.task_id };
      }));
    }
    return socket.attemptTargets.get(attemptId);
  }

  async function liveCode(socket, message) {
    if (!message || typeof message !== 'object') return;
    const target = await attemptTarget(socket, message);
    if (!target) return;
    const code = String(message.code == null ? '' : message.code).slice(0, 20000);
    const sequence = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(message.sequence) || 0));
    const payload = {
      type:'code_live', lessonId:socket.lessonId, ...target, code, sequence,
      senderRole:socket.role,
    };
    if (socket.role === 'student') sendToTutors(socket.lessonId, payload, socket);
    else sendToStudent(socket.lessonId, target.studentId, payload);
  }

  async function tutorEvent(socket, message) {
    if (socket.role !== 'tutor' || !message || typeof message !== 'object') return;
    if (message.type === 'laser_points' || message.type === 'laser_end') {
      const strokeId = String(message.strokeId || '').slice(0, 80);
      const active = socket.laserStrokes && socket.laserStrokes.get(strokeId);
      if (!active) return;
      if (message.type === 'laser_points') {
        const points = normalizedPoints(message.points);
        if (!points.length || active.points + points.length > 1024) return;
        active.points += points.length;
        sendToStudent(socket.lessonId, active.studentId, {
          type:'laser_points', lessonId:socket.lessonId, taskId:active.taskId, strokeId, points,
        });
      } else {
        socket.laserStrokes.delete(strokeId);
        sendToStudent(socket.lessonId, active.studentId, {
          type:'laser_end', lessonId:socket.lessonId, taskId:active.taskId, strokeId,
        });
      }
      return;
    }
    const studentId = String(message.studentId || '');
    const state = await repository.fullState();
    const lesson = state.lessons.find(item => item.id === socket.lessonId);
    if (!lesson) return;
    const students = lesson.groupId
      ? state.groupMembers.filter(item => item.groupId === lesson.groupId && item.status === 'active').map(item => item.studentId)
      : state.enrollments.filter(item => item.id === lesson.enrollmentId).map(item => item.studentId);
    if (!students.includes(studentId)) return;

    if (message.type === 'laser_start') {
      const taskId = String(message.taskId || '');
      if (!(lesson.taskIds || []).includes(taskId)) return;
      const strokeId = String(message.strokeId || '').slice(0, 80);
      const points = normalizedPoints(message.points, 8);
      if (!strokeId || points.length !== 1) return;
      if (!socket.laserStrokes) socket.laserStrokes = new Map();
      if (socket.laserStrokes.size >= 4) return;
      socket.laserStrokes.set(strokeId, { studentId, taskId, points:1 });
      sendToStudent(socket.lessonId, studentId, {
        type:'laser_start', lessonId:socket.lessonId, taskId, strokeId, points,
      });
      return;
    }
    if (message.type === 'hint') {
      const text = String(message.text || '').trim().slice(0, 500);
      const line = Math.max(1, Math.min(10000, Number(message.line) || 1));
      const taskId = String(message.taskId || '');
      if (!text || !(lesson.taskIds || []).includes(taskId)) return;
      sendToStudent(socket.lessonId, studentId, { type:'hint', lessonId:socket.lessonId, taskId, line, text });
    }
  }

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { socket.destroy(); return; }
      if (url.pathname !== '/live') { socket.destroy(); return; }
      const raw = request.headers.cookie || '';
      const cookie = raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${A.COOKIE}=`));
      const user = await auth.userBySession(cookie ? decodeURIComponent(cookie.slice(A.COOKIE.length + 1)) : null);
      if (!user) { socket.destroy(); return; }
      const lessonId = url.searchParams.get('lesson');
      const state = await repository.fullState();
      const lesson = state.lessons.find(item => item.id === lessonId);
      if (!lesson) { socket.destroy(); return; }
      const profile = await auth.profileOf(user);
      let allowed = false;
      if (user.role === 'tutor' && profile && lesson.tutorId === profile.id) allowed = true;
      if (user.role === 'student' && profile) {
        if (lesson.groupId) {
          allowed = state.groupMembers.some(item => item.groupId === lesson.groupId && item.studentId === profile.id && item.status === 'active');
        } else {
          const enrollment = state.enrollments.find(item => item.id === lesson.enrollmentId);
          allowed = !!enrollment && enrollment.studentId === profile.id;
        }
      }
      if (!allowed) { socket.destroy(); return; }
      wss.handleUpgrade(request, socket, head, webSocket => {
        webSocket.role = user.role;
        webSocket.userName = user.name;
        webSocket.lessonId = lessonId;
        webSocket.studentId = user.role === 'student' && profile ? profile.id : null;
        webSocket.participantId = `${user.id}:${Date.now().toString(36)}`;
        join(lessonId, webSocket);
        wss.emit('connection', webSocket, request);
      });
    })().catch(() => socket.destroy());
  });

  wss.on('connection', socket => {
    presence(socket.lessonId);
    if (socket.role === 'tutor') {
      void Promise.resolve(repository.fullState()).then(async state => {
        const lesson = state.lessons.find(item => item.id === socket.lessonId);
        if (!lesson) return;
        const students = lesson.groupId
          ? state.groupMembers.filter(item => item.groupId === lesson.groupId && item.status === 'active').map(item => item.studentId)
          : state.enrollments.filter(item => item.id === lesson.enrollmentId).map(item => item.studentId);
        for (const studentId of students) {
          const payload = await snapshotOf(socket.lessonId, studentId);
          if (payload && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'snapshot', ...payload }));
        }
      }).catch(() => undefined);
    }
    socket.on('message', buffer => {
      let message = null;
      try { message = JSON.parse(String(buffer)); } catch { return; }
      if (message?.type === 'ping' && socket.role === 'student' && socket.studentId) {
        push(socket.lessonId, socket.studentId);
      }
      if (message?.type === 'code_live') {
        void liveCode(socket, message).catch(() => undefined);
      }
      if (socket.role === 'tutor' && ['laser_start','laser_points','laser_end','hint'].includes(message?.type)) {
        void tutorEvent(socket, message).catch(() => undefined);
      }
      if (message?.type === 'board_update') {
        void boardUpdate(socket, message).catch(error =>
          logger?.error?.('board_update_failed', { lessonId:socket.lessonId, error:error.message }));
      }
      if (message?.type === 'board_pointer') boardPointer(socket, message);
      if (message?.type === 'board_sync') void sendBoard(socket).catch(() => undefined);
    });
    socket.on('close', () => {
      leave(socket.lessonId, socket);
      presence(socket.lessonId);
      broadcast(socket.lessonId, { type:'board_left', id:socket.participantId });
    });
    socket.on('error', () => leave(socket.lessonId, socket));
  });
  return { push, presence, invalidate, boards, rooms: roomsByLesson };
}

module.exports = { create };
