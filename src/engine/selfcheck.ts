/** @deprecated Prefer `npm test`. Kept so older docs still invoke the suite. */
import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['test'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
