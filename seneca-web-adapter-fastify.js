'use strict';

const _ = require('lodash');
const ReadBody = require('./read-body');

module.exports = function fastify(options, context, auth, routes, done) {
  const seneca = this;

  if (!context) {
    return done(new Error('no context provided'));
  }

  const middleware = options.middleware;

  _.each(routes, route => {
    const routeMiddleware = (route.middleware || []).map(_middleware => {
      const ret = _.isString(_middleware)
        ? middleware[_middleware]
        : _middleware;
      if (!_.isFunction(ret)) {
        throw new Error(`expected valid middleware, got ${_middleware}`);
      }
      return ret;
    });

    _.each(route.methods, method => {
      method = _.toLower(method);

      const handler = (request, reply) => {
        handleRoute(seneca, options, request, reply, route);
      };

      const routeOptions = {
        method: method.toUpperCase(),
        url: route.path,
        preHandler: routeMiddleware,
        handler: handler
      };

      if (!route.auth && !route.secure) {
        context.route(routeOptions);
      } else if (route.secure) {
        routeOptions.preHandler.push((request, reply, done) => {
          if (!request.user) {
            reply.redirect(route.secure.fail);
          } else {
            done();
          }
        });
        context.route(routeOptions);
      } else if (route.auth) {
        routeOptions.preHandler.unshift(auth.authenticate(route.auth.strategy, {
          failureRedirect: route.auth.fail,
          successRedirect: route.auth.pass
        }));
        context.route(routeOptions);
      }
    });
  });

  return done(null, { routes: routes });
}

function handleRoute(seneca, options, request, reply, route) {
  if (options.includeRequest == null) {
    options.includeRequest = true;
  }

  if (options.includeResponse == null) {
    options.includeResponse = true;
  }

  if (options.parseBody) {
    return ReadBody(request, finish);
  }
  finish(null, request.body || {});

  function finish(err, body) {
    if (err) {
      return reply.send(err);
    }

    const payload = {
      args: {
        body: body,
        route: route,
        params: request.params,
        query: request.query,
        user: request.user || null
      }
    };

    if (options.includeRequest) {
      payload.request$ = request;
    }

    if (options.includeResponse) {
      payload.response$ = reply;
    }

    seneca.act(route.pattern, payload, (err, response) => {
      if (err) {
        return reply.send(err);
      }

      if (route.redirect) {
        return reply.redirect(route.redirect);
      }
      if (route.autoreply) {
        return reply.send(response);
      }
    });
  }
}
