/**
 * Some Comments - a comment engine
 * Copyright (C) 2015 Fredrik Liljegren
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU Affero General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
 * the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with this
 * program. If not, see <http://www.gnu.org/licenses/>.
 *
 * @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt
 * GNU-AGPL-3.0
 */

var should   = require('should')
var assert   = require('assert')
var request  = require('supertest')
var config   = require('../config.js.test')
var fs       = require('fs')
var url      = require('url')
var path     = require('path')
var spawn    = require('child_process').spawn
var q        = require('q')
var qsqlite3 = require('q-sqlite3')

var CommentFactory = require('../models/comment')
var SiteFactory    = require('../models/site')
var UserFactory    = require('../models/user')


describe('Routing Integration', function() {
  var serverProcess, baseUrl, db,
  commentFactory, siteFactory, userFactory


  before(function(done) {
    // Start the server
    var subEnv = process.env
    subEnv.COVERAGE = true
    serverProcess = spawn('node', ['index.js', 'config.js.test'], {env: subEnv})

    var serverDeferred = q.defer()

    var dbDone = qsqlite3.createDatabase(config.database.connection.filename)
      .then(function(connectedDb) {
        db = connectedDb
        commentFactory = CommentFactory(db)
        siteFactory    = SiteFactory(db)
        userFactory    = UserFactory(db)
      })

    serverProcess.stdout.on('data', function (buffer) {
      //console.log('Server output: ' + buffer)

      var portRegex = /listening on port (\d+) in/g
      var portMatch = portRegex.exec(buffer.toString())
      if (portMatch) {
        baseUrl = 'http://localhost:' + portMatch[1]
        serverDeferred.resolve()
      }
    })
    serverProcess.stderr.on('data', function (buffer) {console.log('Server error: "' + buffer)})
    serverProcess.stdout.on('end', function() {throw new Error('Server died.')})

    // Wait until both the server and database are ready.
    q.all([serverDeferred.promise, dbDone]).then(function(){done()})

  })
  after(function(done) {
    // Clean the test database
    fs.unlink(config.database.connection.filename)

    // Download the coverage
    var curlProcess = spawn(
      'curl', ['-o', path.resolve('build', 'coverage.zip'), baseUrl + '/coverage/download'],
      {cwd: __dirname}
    )
    curlProcess.stdout.on('end', function() {
      console.log('Coverage report saved in build/coverage.zip.')

      // Kill the server
      serverProcess.kill('SIGKILL')
      done()
    })
  })

  describe('Site access', function() {
    it('should list in JSON if preferred', function(done) {
      request(baseUrl)
        .get('/sites/')
        .set('Accept', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200, done)
    })

    it('should list in HTML if preferred', function(done) {
      request(baseUrl)
        .get('/sites/')
        .set('Accept', 'text/html,application/json')
        .expect('Content-Type', /html/)
        .expect(200, done)
    })
  })

  describe('Site creation', function() {
    it('should require auth', function(done) {
      request(baseUrl)
        .post('/sites/')
        .send({domain: 'example.org'})
        .expect(401, done)
    })
  })

  describe('Page comments', function() {
    it('should give comments with user info', function(done) {
      this.timeout(5000) // Setting up things can take time if hd isn't quick
      // Setup site, page, user and comments
      var admin, site, comment

      userFactory.create({displayName: 'Test User', avatar: 'http://my.avatar/jpg'})
        .then(function(adminIn) {
          admin = adminIn
          return siteFactory.create('mydomain')
        })
        .then(function(siteIn) {
          site = siteIn
          return commentFactory.create(site.id, 'testpage', admin.id, 'This is Some Comment.', null)
        })
        .then(function(comment) {
          request(baseUrl)
            .get('/sites/' + site.id + '/pages/testpage/comments/')
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function(err, res) {
              should.not.exist(err)
              res.body[0].id.should.equal(comment.id)
              res.body[0].displayName.should.equal('Test User')
              done()
            })
        })
        .done()
    })

    it('should require auth to add comment', function(done) {
      siteFactory.create('mydomain')
        .then(function(site) {
          request(baseUrl)
            .post('/sites/' + site.id + '/pages/testpage/comments/')
            .expect(401, done)
        })
        .done()
    })
  })

  describe('Anonymous user', function() {
    it('should be denied access to /users/X', function(done) {
      request(baseUrl)
        .get('/users/1')
        .expect(401, done)
    })
  })

  describe('Logged in user', function() {
    var user, agent

    before(function(done) {
      // Create a user and login with an agent
      userFactory.create({displayName: 'Test User', avatar: 'http://my.avatar/jpg'})
        .then(function(userIn) {
          user = userIn

          // Login
          agent = request.agent(baseUrl)
          agent
            .get('/login/' + user.id)
            .end(function(err, res) {
              agent.saveCookies(res)
              done()
            })
        })
        .done()
    })

    it('should give user info in JSON if preferred', function(done) {
      agent
        .get('/users/' + user.id)
        .set('Accept', 'application/json')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          should.not.exist(err)

          res.body.displayName.should.equal('Test User')
          res.body.avatar.should.equal('http://my.avatar/jpg')
          should.not.exist(res.body.email)
          done()
        })
    })

    //it('should add comment if user is logged in', function(done) {
    //  siteFactory.create('mydomain')
    //    .then(function(site) {
    //      request(baseUrl)
    //        .post('/sites/' + site.id + '/pages/testpage/comments/')
    //        .expect(401, done)
    //    })
    //})
  })
})
