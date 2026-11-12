import { Buffer } from 'buffer';

// isomorphic-git в браузере ожидает глобальный Buffer.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
