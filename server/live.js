const { WebSocket, WebSocketServer } = require('ws');
const A = require('./auth.js');

function create(server, dependencies) {
  const { auth, repository } = dependencies;
  const wss = new WebSocketServer({ noServer: true });
  const roomsByLesson = new Map();

  function join(lessonId, socket) {
    if (!roomsByLesson.has(lessonId)) roomsByLesson.set(lessonId, new Set());
    roomsByLesson.get(lessonId).add(socket);
  }
  function leave(lessonId, socket) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    room.delete(socket);
    if (!room.size) roomsByLesson.delete(lessonId);
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
      if (socket.readyState === WebSocket.OPEN && socket.role === 'tutor') socket.send(message);
    });
  }
  function presence(lessonId) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const who = [...room].map(socket => ({ role: socket.role, name: socket.userName }));
    const message = JSON.stringify({ type: 'presence', lessonId, who });
    room.forEach(socket => { if (socket.readyState === WebSocket.OPEN) socket.send(message); });
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
    });
    socket.on('close', () => { leave(socket.lessonId, socket); presence(socket.lessonId); });
    socket.on('error', () => leave(socket.lessonId, socket));
  });
  return { push, presence, rooms: roomsByLesson };
}

module.exports = { create };
