# kashmir

NodeJS base cache optimised for medium to large data files.

The cached data is stored in local files honoring a maximum storage capacity.

Files gets evicted following a LRU policy and a minimum TTL policy. A cached entry can
only be evicted if it has passed more than TTL milliseconds since it last hit. You
can disable the TTL policy by specifying 0 milliseconds, otherswise defaults to one hour.

Entries to be cached can include a "meta" data object for user define metadata that must
be stored along the cached entries.

Notes:
  - the cache is not designed to work for several processes accessing to it at the same time.
  - setting the same key more than once if the key is already cached will just be ignored.

## Usage

```js
var cache = new kashmir.Cache('/my/cache/dir', {
  ttl: 1000 * 60 * 60, //  defaults to 1 hour.
  maxSize: 1024 * 1024 * 256 // defaults to 256Mb.
});

cache.set('mykey', sourceStream, size, meta).then( (cached) => {
  // cached true if the sourceStream could be cached.

});


cache.get('mykey').then( (cached) => {
  /* returns cached if entry was cached with the following data:
    {
      size: size,
      stream: stream,
      meta: meta
    }
  */
});

```
