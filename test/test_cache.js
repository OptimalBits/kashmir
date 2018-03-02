const Cache = require("../src/cache");
const expect = require("chai").expect;
const fs = require("fs");
const Promise = require('bluebird');
const _ = require('lodash');

const stream = require("stream");

const ONE_MEGABYTE = 1024 * 1024;
const CACHE_001 = __dirname + "/scrap/cache001";

const filenames = [
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
          expect(cache.files[0].stats.size).to.be.equal(size);
          expect(cache.currentSize).to.be.equal(size);

          return cache.get(filename).then(cached => {
            expect(cached).to.have.property('stream');
            expect(cached).to.have.property('size');
            expect(cached).to.have.property('meta');
            
            expect(cached.stream instanceof stream.Readable).to.be.equal(true);
          });
        });
      });
    });

    it("should set a item with metadata", function() {
      const cache = new Cache(CACHE_001);

      const filename = __dirname + "/fixtures/file1.png";
      const readStream = fs.createReadStream(filename);
      const size = fs.statSync(filename).size;
      const metadata = {foo: 'bar'};
      const totalSize = size + Buffer(JSON.stringify(metadata)).length;

      return cache.set(filename, readStream, size, metadata).then(function(cached) {
        expect(cached).to.be.equal(true);
        expect(cache.files).to.have.lengthOf(1);
        expect(cache.files[0].stats.size).to.be.equal(totalSize);
        expect(cache.currentSize).to.be.equal(totalSize);

        return cache.get(filename).then(cached => {
          expect(cached).to.have.property('stream');
          expect(cached).to.have.property('size');
          expect(cached).to.have.property('meta');
          
          expect(cached.stream instanceof stream.Readable).to.be.equal(true);
        });
      });
    });

    it("should evict an item if needed", function() {
      const files = _.map(filenames.slice(0, 4), prepareInput);
      const size = _.reduce(files, (sum, file) => sum + file.size, 0);

      const cache = new Cache({ path: CACHE_001, maxSize: size, ttl: 0 });

      return cache.open().then(() => {
  
        expect(cache.files).to.have.lengthOf(0);

        return Promise.map(files, (file) => cache.set(file.filename, file.stream, file.size)
        ).then((cached) => {
          _.each(cached, (c) => {
            expect(c).to.be.equal(true);
          });
          
          expect(cache.files).to.have.lengthOf(4);
          expect(cache.currentSize).to.be.equal(size);

          const file = prepareInput(filenames[4]);
          return cache.set(file.filename, file.stream, file.size)
          .then( () => {
            expect(cache.files).to.have.lengthOf(4);
            expect(cache.currentSize).to.be.lessThan(size);
          });
        });
      });
    });

    it("should not cache if not enough room", function() {
      const files = _.map(filenames.slice(0, 2), prepareInput);
      const size = _.reduce(files, (sum, file) => sum + file.size, 0);

      const cache = new Cache({path: CACHE_001, maxSize: size, ttl: 0 });

      return cache.open().then(() => {
  
        expect(cache.files).to.have.lengthOf(0);

        return Promise.map(files, (file) => cache.set(file.filename, file.stream, file.size)
        ).then((cached) => {
          _.each(cached, (c) => {
            expect(c).to.be.equal(true);
          });
          
          expect(cache.files).to.have.lengthOf(2);
          expect(cache.currentSize).to.be.equal(size);

          const file = prepareInput(filenames[2]);
          return cache.set(file.filename, file.stream, file.size)
          .then( () => {
            expect(cache.files).to.have.lengthOf(2);
            expect(cache.currentSize).to.be.equal(size);
          });
        });
      });
    });

    it("should not cache if ttl not expired", function() {
      const files = _.map(filenames.slice(0, 3), prepareInput);
      const size = _.reduce(files, (sum, file) => sum + file.size, 0);

      const cache = new Cache({ path: CACHE_001, maxSize: size, ttl: 1000 * 60});

      return cache.open().then(() => {
  
        expect(cache.files).to.have.lengthOf(0);

        return Promise.map(files, (file) => cache.set(file.filename, file.stream, file.size)
        ).then((cached) => {
          _.each(cached, (c) => {
            expect(c).to.be.equal(true);
          });
          
          expect(cache.files).to.have.lengthOf(3);
          expect(cache.currentSize).to.be.equal(size);

          const file = prepareInput(filenames[3]);
          return cache.set(file.filename, file.stream, file.size)
          .then( () => {
            expect(cache.files).to.have.lengthOf(3);
            expect(cache.currentSize).to.be.equal(size);
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
