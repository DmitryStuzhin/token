(function () {
  'use strict';

  const MAX_CODE_LENGTH = 50_000;
  const MAX_OUTPUT_LENGTH = 20_000;

  function send(payload) {
    parent.postMessage(payload, '*');
  }

  window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.type !== 'python-run') return;
    const requestId = String(event.data.requestId || '');
    const code = String(event.data.code || '');
    if (!requestId || code.length > MAX_CODE_LENGTH) {
      send({ type:'python-result', requestId, ok:false, error:'Код слишком большой' });
      return;
    }

    let output = '';
    try {
      if (!window.Sk) throw new Error('Среда Python не загрузилась');
      Sk.execLimit = 3_000;
      Sk.configure({
        output:text => { output = (output + text).slice(0, MAX_OUTPUT_LENGTH); },
        read:name => {
          if (Sk.builtinFiles?.files[name]) return Sk.builtinFiles.files[name];
          throw new Error(`Модуль ${name} не найден`);
        },
        inputfun:() => Promise.resolve('4 9 12 15'),
        inputfunTakesPrompt:true,
        __future__:Sk.python3,
      });
      await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, code, true));
      send({ type:'python-result', requestId, ok:true, output });
    } catch (error) {
      send({
        type:'python-result',
        requestId,
        ok:false,
        error:String(error).replace(/^ExternalError:\s*/, '').split('\n')[0],
      });
    }
  });

  send({ type:'python-runner-ready' });
})();
