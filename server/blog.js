const BLOGPOSTS_PER_PAGE = 12;
var lastTumblrCheck;

var Posts = new Meteor.Collection("Posts");

Meteor.methods({
  checkTumblr: function()
  {
    // Only check once every minute
    if (new Date() - lastTumblrCheck < 60*1000)
      return;

    lastTumblrCheck = new Date();
    this.unblock();
    Meteor.http.get("http://api.tumblr.com/v2/blog/blog.q42.nl/posts", {
      params: { api_key: TUMBLR_KEY, limit: 5 }
    }, function(error, result) {
      var count = result.data && result.data.response && result.data.response.posts && result.data.response.posts.length;
      if (result.statusCode == 200 && count)
      {
        console.log("Updating " + count + " from Tumblr.")
        for (var i = 0; i < count; i++)
          upsertPost(result.data.response.posts[i]);
      }
      else
      {
        if (count !== 0)
          console.log("Unexpected result:", result);
        if (error)
          console.log("Error:", error);
      }
    });
  },
  reimportTumblr: function(offset)
  {
    this.unblock();
    if (!offset)
    {
      Posts.remove({});
      offset = 0;
    }
    Meteor.http.get("http://api.tumblr.com/v2/blog/blog.q42.nl/posts", {
      params: { api_key: TUMBLR_KEY, limit: 20, offset: offset }
    }, function(error, result) {
      var count = result.data && result.data.response && result.data.response.posts && result.data.response.posts.length;
      if (result.statusCode == 200 && count)
      {
        console.log("Importing " + count + " from Tumblr.")
        for (var i = 0; i < count; i++)
          upsertPost(result.data.response.posts[i]);
        Meteor.call("reimportTumblr", offset + 20);
      }
      else
      {
        if (count !== 0)
          console.log("Unexpected result:", result);
        if (error)
          console.log("Error:", error);
      }
    });
  },
  addComment: function(blogpostId, text)
  {
    if (!text)
      return;

    BlogComments.insert({
      text: text,
      blogpostId: blogpostId,
      userName: Meteor.user().profile.name,
      userId: Meteor.userId(),
      date: new Date()
    });
  },
  updateComment: function(_id, text)
  {
    BlogComments.update(commentSecurityFilter(_id), { $set: { text: text } });
  },
  deleteComment: function(_id)
  {
    BlogComments.remove(commentSecurityFilter(_id));
  }
})

function upsertPost(post)
{
  post.prettyDate = post.date.substr(8, 2) + "-" + post.date.substr(5, 2) + "-" + post.date.substr(0, 4);
  if (post.body)
  {
    var pos = post.body.indexOf("<!-- more -->");
    post.intro = pos > -1 ? post.body.substring(0, pos) : post.body;
  }
  if (post.tags)
    post.tags = post.tags.map(function(s) { return s.toLowerCase() });
  if (!Posts.findOne({ id: post.id }))
    Posts.insert(post);
  else
    Posts.update({ id: post.id }, post);
}

function commentSecurityFilter(_id) {
  return Meteor.user().isAdmin ? { _id: _id } : { _id: _id, userId: Meteor.userId() };
}

publishRenamed("blogpostIndex", function (page, tag) {
  page = page || 1;
  var filter = tag ? { tags: tag } : {};
  return Posts.find(filter, {
    limit: BLOGPOSTS_PER_PAGE,
    skip: (page - 1) * BLOGPOSTS_PER_PAGE,
    sort: { timestamp: -1 },
    fields: { body: false }
  });
});

publishRenamed("blogpostFull", function (id) {
  return Posts.find({ id: id });
});

publishRenamed("LatestComments", function(limit) {
  return BlogComments.find({}, { sort: { date: -1 }, limit: limit })
});

Meteor.publish("pagesByTag", function (tag) {
  var self = this;
  var uuid = Meteor.uuid();
  var count = 0;
  var initializing = true;

  var filter = tag ? {tags: tag} : {};
  var handle = Posts.find(filter).observeChanges({
    added: function () {
      count++;
      if (!initializing)
        self.changed("PageCounts", uuid, {tag: tag, count: Math.ceil(count / BLOGPOSTS_PER_PAGE)});
    },
    removed: function () {
      count--;
      self.changed("PageCounts", uuid, {tag: tag, count: Math.ceil(count / BLOGPOSTS_PER_PAGE)});
    }
    // don't care about moved or changed
  });

  // Observe only returns after the initial added callbacks have
  // run.  Now mark the subscription as ready.
  initializing = false;
  self.added("PageCounts", uuid, {tag: tag, count: Math.ceil(count / BLOGPOSTS_PER_PAGE)});
  self.ready();

  // stop observing the cursor when client unsubs
  self.onStop(function () {
    handle.stop();
  });
});

Meteor.publish("blogComments", function (blogpostId) {
  return BlogComments.find({ blogpostId: blogpostId });
});

if (Posts.find().count() == 0)
  Meteor.call("reimportTumblr");
