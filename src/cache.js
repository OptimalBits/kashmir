const crypto = require("crypto");
const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));
const rimraf = Promise.promisify(require("rimraf"));
const mkdirp = Promise.promisify(require('mkdirp'));
const _ = require("lodash");
const path = require("path");

const ONE_HOUR = 1000 * 60 * 60;

/**
 * opts: {
 *   ttl: min time to live (a cached object lives at least ttl before it can be evicted).
 *   maxSize: max size in MB.
 * }
 *
 */
function Cache(cachePath, opts) {
  this.path = cachePath;
  this.opts = _.defaults(opts, {
    ttl: ONE_HOUR,
    maxSize: 1024 * 1024 * 256 // 256Mb
  });
  this.filesMapper = {};
  this.currentSize = 0;

  // Oldest items placed at the begining of the array
  this.files = [];
}

/**
 *
 * @returns {Promise} Resolves when the cache has been opened sucessfully.
 */
Cache.prototype.open = function() {
  return (this.opening = createDirIfNeeded(this.path).then(() =>
    fs
      .statAsync(this.path)
      .then(stats => stats)
      .then(() =>
        fs
          .readdirAsync(this.path)
          .then(files =>
            Promise.map(files, file =>
              fs.statAsync(path.join(this.path, file)).then(stats => {
                return { file, stats };
              })
            )
          )
          .then(files => _.groupBy(files, "file"))
          .then(filesMapper => (this.filesMapper = filesMapper))
          .then(
            filesMapper =>
              (this.files = _.keys(filesMapper).sort(
                (a, b) => filesMapper[a].atimeMs - filesMapper[b].atimeMs
              ))
          )
      )
  ));
};

function createDirIfNeeded(dirPath) {
  return fs
    .statAsync(dirPath)
    .then(stats => void 0)
    .catch(err => {
      if(err.code === 'ENOENT'){
        return mkdirp(dirPath);
      }
      throw err;
    });
}

function keyToHash(key) {
  return crypto
    .createHmac("sha256", "kashmir")
    .update(key)
    .digest("hex");
}

/**
 * Evict file if possible.
 * @returns the size of the evicted file
 */
Cache.prototype.evictFile = function() {
  const file = this.files[0] ? this.filesMapper[this.files[0].file] : null;
  if (file && Date.now() - file.stats.atimeMs > this.opts.ttl) {
    this.files.shift();
    delete this.filesMapper[file.file]; // There may be a small hazzard here.
    this.currentSize -= file.stats.size;
    return fs.unlinkAsync(file.file).then(() => file.stats.size);
  } else {
    return Promise.resolve(false);
  }
};

Cache.prototype.evictFiles = function(size) {
  if (size > 0) {
    return this.evictFile().then(
      evictedSize => (evictedSize ? this.evictFiles(size - evictedSize) : false)
    );
  } else {
    return Promise.resolve(true);
  }
};

Cache.prototype.set = function(key, stream, size) {
  const _this = this;

  const totalSize = this.currentSize + size;
  if (this.opts.maxSize < totalSize) {
    if( this.opts.maxSize >= size) {
      return this.evictFiles(totalSize - this.opts.maxSize).then(evictedEnough => {
        if (evictedEnough) {
          return cacheFile(key, stream, size);
        }
      });
    } else {
      return Promise.resolve(false);
    }
  } else {
    return cacheFile(key, stream, size);
  }

  function cacheFile(key, stream) {
    const filename = path.join(_this.path, keyToHash(key));

    _this.currentSize += size;

    const filePromise = new Promise((resolve, reject) => {
      const endFn = () => {
        removeListeners();
        resolve(true);
      };

      const errorFn = err => {
        removeListeners();
        reject(err);
      };

      const dstStream = fs.createWriteStream(filename);
      stream.pipe(dstStream);

      stream.on("end", endFn);
      stream.on("error", errorFn);
      dstStream.on("error", errorFn);

      function removeListeners() {
        stream.removeListener("end", endFn);
        stream.removeListener("error", errorFn);
        dstStream.removeListener("error", errorFn);
      }
    });

    const atimeMs = Date.now();
    const file = {
      file: filename,
      stats: { atimeMs: atimeMs, size: size },
      filePromise: filePromise
    };

    _this.files.push(file);
    _this.filesMapper[filename] = file;

    return filePromise;
  }
};

/**
 *
 * @param {String} key
 * @returns {Promise<Stream>} Promise that resolves to a string or null if not cached.
 */
Cache.prototype.get = function(key) {
  const filename = path.join(this.path, keyToHash(key));
  const file = this.filesMapper[filename];
  if (file) {
    return file.filePromise.then(() => {
      return fs.createReadStream(file.file);
    });
  }
  return Promise.resolve();
};

/**
 * Cleans the cache completely.
 *
 */
Cache.prototype.clean = function() {
  this.files = [];
  this.filesMapper = {};
  return rimraf(this.path);
};

module.exports = Cache;
