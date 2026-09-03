const { withGradleProperties } = require('expo/config-plugins');

/**
 * Raises the Gradle daemon's memory ceiling.
 *
 * The prebuild template ships `-Xmx2048m -XX:MaxMetaspaceSize=512m`, which is
 * enough for a debug build and not enough for a release one: R8 loads the whole
 * program to minify it, and the build dies with a bare `Metaspace` after four
 * minutes of work. The message names no task and no cause, so it is worth not
 * having to diagnose twice.
 *
 * In a config plugin because android/gradle.properties is generated — see the
 * note in withReleaseSigning.js.
 */

const JVM_ARGS = '-Xmx6144m -XX:MaxMetaspaceSize=2048m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const properties = gradleConfig.modResults;
    const existing = properties.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );

    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    }

    return gradleConfig;
  });
};
