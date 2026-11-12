import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function sourceRevision(root) {
  const git = args => execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();
  try {
    if (resolve(git(['rev-parse','--show-toplevel'])) !== resolve(root)) return { commit:null, dirty:null };
    return { commit:git(['rev-parse','HEAD']), dirty:Boolean(git(['status','--porcelain','--untracked-files=normal'])) };
  } catch { return { commit:null, dirty:null }; }
}
