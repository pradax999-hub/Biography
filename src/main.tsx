// temporary harness: engine only
import { Engine } from './webgl/Engine';

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.appendChild(canvas);
const engine = new Engine({ canvas, onStats: s => ((window as any).__stats = s), onFail: r => ((window as any).__fail = r) });
(window as any).__engine = engine;
engine.start();
addEventListener('resize', () => engine.resize());
addEventListener('pointermove', e => engine.setPointer(e.clientX, e.clientY));
