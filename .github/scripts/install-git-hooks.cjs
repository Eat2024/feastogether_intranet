const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Docker build 不含 .git；僅在開發者的 Git checkout 安裝。
if (fs.existsSync('.git')) {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    stdio: 'inherit',
  });
}
