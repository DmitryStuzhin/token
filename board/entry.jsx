import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

/**
 * Тонкая обёртка: страницы Token остаются на ванильном JS и ничего не знают
 * ни про React, ни про внутренности редактора.
 */
function mount(container, options = {}) {
  const root = createRoot(container);
  let api = null;
  root.render(
    <Excalidraw
      excalidrawAPI={value => { api = value; options.onReady?.(value); }}
      onChange={(elements, appState) => options.onChange?.(elements, appState)}
      langCode="ru-RU"
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
    />,
  );
  return {
    updateScene: scene => api?.updateScene(scene),
    getElements: () => api?.getSceneElements() ?? [],
    destroy: () => root.unmount(),
  };
}

window.TokenBoard = { mount };
