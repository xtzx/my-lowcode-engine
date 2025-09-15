const { execSync } = require('child_process');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const fse = require('fs-extra');

// get version from git branch name,
//  e.g. release/1.0.7 => 1.0.7
//       release/1.0.7-beta => 1.0.7 (beta)
//       release/1.0.7-beta.0 => 1.0.7 (beta)
function getVersion() {
  const gitBranchName = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' });
  const reBranchVersion = /^(?:[\w-]+\/)(\d+\.\d+\.\d+)(-?beta)?(?:\.\d+)?$/im;

  const match = reBranchVersion.exec(gitBranchName);
  if (!match) {
    console.warn(`[engine] gitBranchName: ${gitBranchName}`);
    return 'N/A';
  }

  const [_, version, beta] = match;

  return beta && beta.endsWith('beta') ? `${version}-beta` : version;
}

const releaseVersion = getVersion();

module.exports = ({ context, onGetWebpackConfig }) => {
  onGetWebpackConfig((config) => {
    config.resolve
      .plugin('tsconfigpaths')
      .use(TsconfigPathsPlugin, [{
        configFile: './tsconfig.json',
      }]);
    config
      .plugin('define')
      .use(context.webpack.DefinePlugin, [{
        VERSION_PLACEHOLDER: JSON.stringify(releaseVersion),
      }]);
    config.plugins.delete('hot');
    config.devServer.hot(false);

    // 临时保留console.log，生产环境调试用
    // TODO: 后续需要恢复删除console.log的配置
    // 方法1: 完全禁用代码压缩（保留所有console.log和调试信息）
    // config.optimization.minimize(false);

    // 方法2: 如果需要压缩但保留console.log，可以用以下配置替换上面的行
    // config.when(config.get('mode') === 'production', (config) => {
    //   config.optimization.minimizer('terser').tap((args) => {
    //     args[0].terserOptions = {
    //       ...args[0].terserOptions,
    //       compress: {
    //         ...args[0].terserOptions?.compress,
    //         drop_console: false,
    //         drop_debugger: false
    //       }
    //     };
    //     return args;
    //   });
    // });
  });
};
