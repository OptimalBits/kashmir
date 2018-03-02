const crypto = require("crypto");
const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));
const rimraf = Promise.promisify(require("rimraf"));
const mkdirp = Promise.promisify(require("mkdirp"));
const _ = require("lodash");
const path = require("path");

const ONE_HOUR = 1000 * 60 * 60;

/**
 * opts: {
 *   ttl: min time to live in milliseconds (a cached object lives at least ttl before it can be evicted).
 *   maxSize: max size in bytes.
 * }
 *
 */
function Cache(opts) {
  opts = opts || {};
  this.path = typeof opts === 'string' ? opts : opts.path;

  this.opts = _.defaults(opts, {
    ttl: ONE_HOUR,
    maxSize: 1024 * 1024 * 256 // 256Mb
  });
  this.filesMapper = {};
  this.currentSize = 0;

  // Oldest items placed at the begining of the array
  this.files = [];

  if (this.path) {
    this.open();
  }
}

/**
 *
 * @returns {Promise} Resolves when the cache has been opened sucessfully.
 */
Cache.prototype.open = function() {
  if (this.opening) {
    return this.opening;
  }
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
          .then(files =>
            _.groupBy(
              files,
              file => (file.file.endsWith(".json") ? "meta" : "files")
            )
          )
          .then(grouped => {
            this.metas = _.groupBy(grouped.metas, "file");
            return (this.filesMapper = _.groupBy(grouped.files, "file"));
          })
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
      if (err.code === "ENOENT") {
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
    const metaFilename = file.file + '.json';
    this.files.shift();
    delete this.filesMapper[file.file]; // There may be a small hazzard here.
    delete this.metas[metaFilename];
    this.currentSize -= file.stats.size;
    return fs.unlinkAsync(file.file).then(() => file.stats.size).then( (size) => {
      return fs.unlinkAsync(metaFilename).then( () => size, err => size );
    });
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

Cache.prototype.set = function(key, stream, size, meta) {
  const _this = this;

  return this.opening.then(() => {
    meta = meta ? JSON.stringify(meta) : void 0;
    size = meta ? size + Buffer.from(meta).length : size;

    const totalSize = this.currentSize + size;
    if (this.opts.maxSize < totalSize) {
      if (this.opts.maxSize >= size) {
        return this.evictFiles(totalSize - this.opts.maxSize).then(
          evictedEnough => {
            if (evictedEnough) {
              return cacheFile(key, stream, size, meta);
            }
          }
        );
      } else {
        return Promise.resolve(false);
      }
    } else {
      return cacheFile(key, stream, size, meta);
    }

    function cacheFile(key, stream, size, meta) {

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

      const metaFilename = filename + '.json';
      const metaPromise = meta ? fs.writeFileAsync(metaFilename, meta) : Promise.resolve();

      const atimeMs = Date.now();
      const file = {
        file: filename,
        stats: { atimeMs: atimeMs, size: size },
        filePromise: filePromise
      };

      _this.files.push(file);
      _this.filesMapper[filename] = file;

      if(meta){
        _this.metas[metaFilename] = true;
      }

      return Promise.join(filePromise, metaPromise).then( () => true );
    }
  });
};

/**
 *
 * @param {String} key
 * @returns {Promise<Stream>} Promise that resolves to a string or null if not cached.
 */
Cache.prototype.get = function(key) {
  return this.opening.then(() => {
    const filename = path.join(this.path, keyToHash(key));
    const metaFilename = filename + '.json';
    const file = this.filesMapper[filename];
    const meta = this.metas[metaFilename];
    if (file) {
      return file.filePromise.then(() => (meta ? fs.readFileAsync(metaFilename, {encoding: 'utf-8'}) : Promise.resolve()).then( (meta) => {
          return {
            stream: fs.createReadStream(file.file),
            size: file.stats.size,
            meta: meta ? JSON.parse(meta) : void 0
          }
        })
      );
    }
    return Promise.resolve();
  });
};


/**
 * Cleans the cache completely.
 *
 */
Cache.prototype.clean = function() {
  return this.opening.then(() => {
    this.files = [];
    this.filesMapper = {};
    return rimraf(this.path);
  });
};

module.exports = Cache;
