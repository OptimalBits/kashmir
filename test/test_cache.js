const Cache = require("../src/cache");
const expect = require("chai").expect;
const fs = require("fs");
const Promise = require('bluebird');

const stream = require("stream");

const ONE_MEGABYTE = 1024 * 1024;
const CACHE_001 = __dirname + "/scrap/cache001";

const files = [
  __dirname + "/fixtures/file1.png",
  __dirname + "/fixtures/file2.jpg",
  __dirname + "/fixtures/file3.png",
  __dirname + "/fixtures/file4.jpg",
  __dirname + "/fixtures/file5.png"
];

describe("Cache", function() {
  describe("instantiation", function() {
    it("should return a cache instance", function() {
      const cache = new Cache();
      expect(cache).to.have.property("path");
      expect(cache).to.have.property("opts");
      expect(cache).to.have.property("files");
      expect(cache).to.have.property("filesMapper");
    });
  });

  describe("open", function() {
    it("should open a cache dir", function() {
      const cache = new Cache(CACHE_001);

      return cache.open();
    });
  });

  describe("set", function() {
    beforeEach(() => {
      const cache = new Cache(CACHE_001);
      return cache.clean();
    });

    it("should set a item", function() {
      const cache = new Cache(CACHE_001);

      return cache.open().then(() => {

        expect(cache.files).to.have.lengthOf(0);
        const filename = __dirname + "/fixtures/file1.png";
        const readStream = fs.createReadStream(filename);
        const size = fs.statSync(filename).size;

        return cache.set(filename, readStream, size).then(function(cached) {
          expect(cached).to.be.equal(true);
          expect(cache.files).to.have.lengthOf(1);
          expect(cache.files[0].stats.size).to.be.equal(847509);
          expect(cache.currentSize).to.be.equal(847509);

          return cache.get(filename).then(readStream => {
            expect(readStream instanceof stream.Readable).to.be.equal(true);
          });
        });
      });
    });

    it("should evict an item if needed", function() {
      const file1 = prepareInput(files[0]);
      const file2 = prepareInput(files[1]);
      const file3 = prepareInput(files[2]);
      const file4 = prepareInput(files[3]);
      const file5 = prepareInput(files[4]);

      const size = file1.size + file2.size + file3.size + file4.size

      const cache = new Cache(CACHE_001, { maxSize: size, ttl: 0 });

      return cache.open().then(() => {
  
        expect(cache.files).to.have.lengthOf(0);

        return Promise.join(
          cache.set(file1.filename, file1.stream, file1.size),
          cache.set(file2.filename, file2.stream, file2.size),
          cache.set(file3.filename, file3.stream, file3.size),
          cache.set(file4.filename, file4.stream, file4.size)
        ).spread((cached1, cached2, cached3, cached4) => {
          expect(cached1).to.be.equal(true);
          expect(cached2).to.be.equal(true);
          expect(cached3).to.be.equal(true);
          expect(cached4).to.be.equal(true);

          expect(cache.files).to.have.lengthOf(4);
          expect(cache.currentSize).to.be.equal(size);

  
          return cache.get(file1.filename).then(readStream => {
            expect(readStream instanceof stream.Readable).to.be.equal(true);
          })
          .then( () => cache.set(file5.filename, file5.stream, file5.size))
          .then( () => {
            expect(cache.files).to.have.lengthOf(4);
            expect(cache.currentSize).to.be.lessThan(size);
          });
        });
      });
    });
  });
});

function prepareInput(filename) {
  return {
    filename: filename,
    stream: fs.createReadStream(filename),
    size: fs.statSync(filename).size
  };
}
