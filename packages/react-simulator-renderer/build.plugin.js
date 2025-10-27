module.exports = ({ onGetWebpackConfig }) => {
  onGetWebpackConfig((config) => {
    config.performance.hints(false);

    // 临时保留console.log，生产环境调试用
    // config.optimization.minimize(false);
  });
};
