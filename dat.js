var assert = require('assert')
var path = require('path')
var multicb = require('multicb')
var importFiles = require('./lib/import-files')
var createNetwork = require('./lib/network')
var stats = require('./lib/stats')

module.exports = Dat

function Dat (archive, db, opts) {
  if (!(this instanceof Dat)) return new Dat(archive, db, opts)
  if (typeof opts === 'undefined') return Dat(archive, null, db)
  assert.ok(archive, 'archive required')
  // assert.ok(db, 'database required') // maybe not be required for multidrive...
  assert.ok(opts.dir, 'opts.directory required')

  this.path = path.resolve(opts.dir)
  this.options = opts

  this.archive = archive
  this.db = db
  this.key = archive.key // only resumed/owned archives will have keys here
  this.live = archive.live
  this.owner = archive.owner
  this.resumed = archive.resumed
}

Dat.prototype.join =
Dat.prototype.joinNetwork = function (opts) {
  if (this.network) return this.network.join(this.archive.discoveryKey)
  var self = this

  var network = self.network = createNetwork(self.archive, opts)
  self.options.network = network.options

  network.swarm = network // 1.0 backwards compat
  if (self.owner) return network

  network.once('connection', function () {
    // automatically open archive and set exposed values
    self.archive.open(function () {
      // self.owner = self.archive.owner // For future multi-writer?
      self.live = self.archive.live
    })
  })
  return network
}

Dat.prototype.leave =
Dat.prototype.leaveNetwork = function () {
  if (!this.network) return
  this.network.leave(this.archive.discoveryKey)
}

Dat.prototype.trackStats = function (opts) {
  opts = opts || {}
  assert.ok(opts.db || this.db, 'Dat needs database to track stats')
  this.stats = stats(this.archive, opts.db || this.db)
  return this.stats
}

Dat.prototype.importFiles = function (target, opts, cb) {
  if (!this.archive.owner) return cb(new Error('Must be archive owner to import files.'))
  if (typeof target !== 'string') return this.importFiles('', target, opts)
  if (typeof opts === 'function') return this.importFiles(target, {}, opts)

  var self = this
  target = target.length ? target : self.path

  self.importer = importFiles(self.archive, target, opts, function (err) {
    if (err || self.archive.live) return cb(err)
    // Sets self.key for snapshot
    self.archive.finalize(function (err) {
      if (err) return cb(err)
      self.key = self.archive.key
      // TODO: need to get snapshot key back in db, better way?
      if (self.db) self.db.put('!dat!key', self.archive.key.toString('hex'), cb)
    })
  })
  self.options.importer = self.importer.options
  return self.importer
}

Dat.prototype.close = function (cb) {
  cb = cb || function () { }
  var self = this
  var done = multicb()
  closeNet(done())
  closeFileWatch(done())
  closeArchiveDb(done())

  done(cb)

  function closeArchiveDb (cb) {
    self.archive.close(function (err) {
      if (err) return cb(err)
      if (self.options.db || !self.db) return cb(null)
      closeDb(cb)
    })
  }

  function closeDb (cb) {
    if (!self.db) return cb()
    self.db.close(cb)
  }

  function closeNet (cb) {
    if (!self.network) return cb()
    self.network.close(cb)
  }

  function closeFileWatch (cb) {
    if (!self.importer) return cb()
    self.importer.close()
    cb() // TODO: dat importer close is currently sync-ish
  }
}