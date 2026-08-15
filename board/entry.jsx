import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

/**
 * Обёртка над редактором. Страницы Token остаются на ванильном JS и не знают
 * ни про React, ни про внутренности Excalidraw: наружу торчит только
 * window.TokenBoard.mount с несколькими методами.
 */
function mount(container, options = {}) {
  const root = createRoot(container);
  let api = null;
  let pending = null;

  root.render(
    <Excalidraw
      langCode="ru-RU"
      excalidrawAPI={value => {
        api = value;
        if (pending) {
          api.updateScene(pending);
          pending = null;
        }
        options.onReady?.();
      }}
      onChange={(elements, appState) => options.onChange?.(elements, appState)}
      onPointerUpdate={payload => options.onPointerUpdate?.(payload)}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          // Живая совместная сессия у нас своя, кнопка Excalidraw ведёт на их сервер.
          toggleTheme: true,
        },
      }}
    />,
  );

  return {
    /** До готовности API правки копятся: снимок приходит раньше монтирования. */
    updateScene(scene) {
      if (api) api.updateScene(scene);
      else pending = scene;
    },
    setCollaborators(map) {
      api?.updateScene({ collaborators: map });
    },
    getElements() {
      return api?.getSceneElements() ?? [];
    },
    scrollToContent() {
      api?.scrollToContent(undefined, { fitToContent: true });
    },
    destroy() {
      root.unmount();
    },
  };
}

window.TokenBoard = { mount };
