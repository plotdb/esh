// alias target for 'fs' — route everything to memfs
import { fs } from 'memfs';
export * from 'memfs';
export default fs;
