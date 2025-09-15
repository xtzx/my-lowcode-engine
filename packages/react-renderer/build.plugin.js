
// TODO:这个时候临时文件,正常不能用
// const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

// module.exports = ({ context, onGetWebpackConfig }) => {
//   onGetWebpackConfig((config) => {
//     config.resolve
//       .plugin('tsconfigpaths')
//       .use(TsconfigPathsPlugin, [{
//         configFile: './tsconfig.json',
//       }]);

//     config.plugins.delete('hot');
//     config.devServer.hot(false);

//     // 临时保留console.log，生产环境调试用
//     // TODO: 后续需要恢复删除console.log的配置
//     // 完全禁用代码压缩（保留所有console.log和调试信息）
//     config.optimization.minimize(false);
//   });
// };
