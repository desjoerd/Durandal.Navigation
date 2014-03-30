/// <reference path="../../typings/durandal/durandal.d.ts" />
/// <reference path="../../typings/knockout/knockout.d.ts" />
define(["require", "exports", "durandal/system", "plugins/router"], function(require, exports, _system, _router) {
    var setImmediate = setImmediate || setTimeout;

    var routeStripper = /^[#\/]|\s+$/g;
    var optionalParam = /\((.*?)\)/g;
    var namedParam = /(\(\?)?:\w+/g;

    var escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;
    var splatParam = /\*\w+/g;

    var knownRoutesChangeCount = 0;
    var knownRoutes = [];

    function install() {
        _router.on('router:route:after-config', onRouteAfterConfig);
        registerBindingHandlers();
        //registerQueryMappers();
    }
    exports.install = install;

    function onRouteAfterConfig(route, router) {
        knownRoutes.push(route);
        knownRoutesChangeCount++;
    }

    function registerBindingHandlers() {
        ko.bindingHandlers['hash'] = {
            update: function (element, valueAccessor, allBindings, viewModel, bindingContext) {
                var settings = ko.unwrap(valueAccessor());

                var hash;
                if (typeof settings == 'string') {
                    hash = settings;
                } else {
                    hash = settings.url();
                }
                ko.bindingHandlers.attr.update(element, function () {
                    return { href: hash };
                }, allBindings, viewModel, bindingContext);
            }
        };
    }

    function hash(route, params, query) {
        if (typeof route === "undefined") { route = ''; }
        if (typeof params === "undefined") { params = {}; }
        if (typeof query === "undefined") { query = {}; }
        return new Hash(route, params, query);
    }
    exports.hash = hash;

    var Hash = (function () {
        function Hash(route, params, query) {
            if (typeof route === "undefined") { route = ''; }
            if (typeof params === "undefined") { params = {}; }
            if (typeof query === "undefined") { query = {}; }
            var _this = this;
            this.route = ko.observable(route);
            this.route.subscribe(function (newValue) {
                _this.routeParamKeysCache = null;
                _this.routePatternCache = null;
                _this.routeConfigCache = null;
            });

            this.params = ko.observable(params);
            this.query = ko.observable(query);

            this.url = ko.computed(function () {
                return exports.buildHash(_this.route(), _this.params(), _this.query());
            });

            this.isActiveRouteMatch = ko.computed(function () {
                return _this.matchActiveRoute();
            });
            this.isActiveParamsMatch = ko.computed(function () {
                return _this.matchActiveRoute() && _this.matchActiveParams();
            });
            this.isActiveQueryMatch = ko.computed(function () {
                return _this.matchActiveRoute() && _this.matchActiveParams() && _this.matchActiveQuery();
            });
        }
        Hash.prototype.matchActiveRoute = function () {
            return this.getRouteConfigs().some(function (c) {
                return c.isActive();
            });
        };

        Hash.prototype.matchActiveParams = function () {
            var hashParams = this.getParamsAsArray();
            var activeParams = _router.activeInstruction().params;

            var activeParamsLength = (!!_router.activeInstruction().queryParams) ? activeParams.length - 1 : activeParams.length;

            if (hashParams.length > activeParamsLength) {
                return false;
            }

            for (var i = 0; i < hashParams.length; i++) {
                if (hashParams[i] != activeParams[i]) {
                    return false;
                }
            }
            return true;
        };

        Hash.prototype.matchActiveQuery = function () {
            var activeQuery = _router.activeInstruction().queryParams;
            var hashQuery = unwrapAttributes(this.query());

            if (activeQuery) {
                for (var attr in hashQuery) {
                    // mapQuery
                    hashQuery[attr] = exports.MapToQuery(hashQuery[attr]);

                    if (hashQuery[attr] && activeQuery[attr] != hashQuery[attr]) {
                        return false;
                    }
                }
            }
            return true;
        };

        Hash.prototype.getParamsAsArray = function () {
            var routeParamKeys = this.getRouteParamKeys();
            var params = this.params();

            var result = [];
            for (var i = 0; i < routeParamKeys.length; i++) {
                if (params[routeParamKeys[i]]) {
                    result.push(ko.unwrap(params[routeParamKeys[i]]));
                } else {
                    result.push(null);
                }
            }
            return result;
        };

        Hash.prototype.getRouteConfigs = function () {
            if (this.routeConfigCache && this.routeConfigCacheChangeCount == knownRoutesChangeCount) {
                return this.routeConfigCache;
            } else {
                var matchedConfigs = [];
                for (var i = 0; i < knownRoutes.length; i++) {
                    if (knownRoutes[i].routePattern.test(this.route())) {
                        matchedConfigs.push(knownRoutes[i]);
                    }
                }

                this.routeConfigCacheChangeCount = knownRoutesChangeCount;
                return this.routeConfigCache = matchedConfigs;
            }
        };

        Hash.prototype.getRoutePattern = function () {
            return this.routePatternCache = this.routePatternCache || createRoutePattern(this.route());
        };

        Hash.prototype.getRouteParamKeys = function () {
            return this.routeParamKeysCache = this.routeParamKeysCache || createRouteParamKeys(this.getRoutePattern(), this.route());
        };
        return Hash;
    })();
    exports.Hash = Hash;

    function buildHash(route, params, query) {
        if (typeof params === "undefined") { params = {}; }
        if (typeof query === "undefined") { query = {}; }
        return _router.convertRouteToHash(exports.buildUrl(route, params, query));
    }
    exports.buildHash = buildHash;

    function buildUrl(route, params, query) {
        if (typeof params === "undefined") { params = {}; }
        if (typeof query === "undefined") { query = {}; }
        var unwrappedParams = unwrapAttributes(params);
        var unwrappedQuery = unwrapAttributes(query);

        for (var queryKey in unwrappedQuery) {
            unwrappedQuery[queryKey] = exports.MapToQuery(unwrappedQuery[queryKey]);
        }

        return buildFragment(route, unwrappedParams) + buildQueryString(unwrappedQuery);
    }
    exports.buildUrl = buildUrl;

    function buildFragment(route, params) {
        var fragment = route.replace(optionalParam, function (match) {
            var paramName = match.match(/\w+/)[0];
            var paramValue = params[paramName];
            if (paramValue) {
                return match.replace(/[()]/g, '');
            } else {
                return '';
            }
        }).replace(namedParam, function (match) {
            var paramName = match.match(/\w+/)[0];
            var paramValue = params[paramName];
            if (paramValue) {
                return encodeURIComponent(paramValue);
            } else {
                return '';
            }
        });

        return fragment;
    }

    function buildQueryString(query) {
        var queryString = '?';

        for (var queryParamName in query) {
            var queryValue = query[queryParamName];
            if (queryValue === undefined || queryValue === null || queryValue === '') {
                continue;
            }
            if (queryString != '?') {
                queryString += '&';
            }

            queryString += queryParamName + '=' + encodeURIComponent(query[queryParamName]);
        }

        if (queryString == '?') {
            return '';
        } else {
            return queryString;
        }
    }

    function unwrapAttributes(obj) {
        var unwrapped = {};

        for (var attr in obj) {
            unwrapped[attr] = ko.unwrap(obj[attr]);
        }

        return unwrapped;
    }

    function createRouteParamKeys(routePattern, route) {
        var params = routePattern.exec(route).slice(1);

        for (var i = 0; i < params.length; i++) {
            var current = params[i];
            var decoded = current ? decodeURIComponent(current) : null;
            params[i] = decoded ? decoded.match(/\w+/)[0] : null;
        }

        return params;
    }

    function createRoutePattern(routeString) {
        routeString = routeString.replace(escapeRegExp, '\\$&').replace(optionalParam, '(?:$1)?').replace(namedParam, function (match, optional) {
            return optional ? match : '([^\/]+)';
        }).replace(splatParam, '(.*?)');

        return new RegExp('^' + routeString + '$');
    }

    function updateQuery(query, options, skipQueryMapping) {
        if (typeof options == 'undefined') {
            options = true;
        }

        if (!skipQueryMapping) {
            for (var queryKey in query) {
                query[queryKey] = exports.MapToQuery(query[queryKey]);
            }
        }

        var currentFragment = _router.activeInstruction().fragment;
        var currentQuery = _router.activeInstruction().queryParams;
        var newQuery = _system.extend({}, currentQuery, query);

        var queryString = buildQueryString(newQuery);

        if (_system.isObject(options) && !options.trigger) {
            // queryParams of the active instruction is only updated when navigation is triggered.
            _router.activeInstruction().queryParams = newQuery;
        }

        return _router.navigate(currentFragment + queryString, options);
    }
    exports.updateQuery = updateQuery;

    var queryBindSubscriptions;
    var volatileQuery;
    var volatileOptions;

    function bindQuery(config) {
        exports.unbindQuery();

        //TODO two way bind because of mapping
        queryBindSubscriptions = [];
        for (var queryAttr in config) {
            var bindQuerySetting = config[queryAttr];

            var navigationOptions;
            var queryObservable;
            if (ko.isObservable(bindQuerySetting)) {
                navigationOptions = { trigger: true, replace: false };
                queryObservable = bindQuerySetting;
            } else {
                navigationOptions = bindQuerySetting.options;
                queryObservable = bindQuerySetting.value;
            }

            var binder = {
                options: navigationOptions,
                property: queryAttr,
                value: queryObservable,
                update: function (newValue) {
                    //mapQuery
                    newValue = exports.MapToQuery(newValue);

                    // check for double navigation
                    if (_router.activeInstruction().queryParams && _router.activeInstruction().queryParams[this.property] == newValue) {
                        return;
                    }

                    if (volatileQuery) {
                        volatileQuery[this.property] = newValue;
                        volatileOptions.trigger = this.options.trigger || volatileOptions.trigger;
                        volatileOptions.replace = this.options.replace || volatileOptions.replace;
                    } else {
                        volatileQuery = {};
                        volatileQuery[this.property] = newValue;

                        volatileOptions = {};
                        volatileOptions.trigger = this.options.trigger || volatileOptions.trigger;
                        volatileOptions.replace = this.options.replace || volatileOptions.replace;

                        setImmediate(function () {
                            exports.updateQuery(volatileQuery, volatileOptions);
                            volatileQuery = null;
                            volatileOptions = null;
                        });
                    }
                }
            };

            var subscription = queryObservable.subscribe(binder.update, binder);
            queryBindSubscriptions.push(subscription);
        }
    }
    exports.bindQuery = bindQuery;

    function unbindQuery() {
        if (queryBindSubscriptions) {
            for (var i = 0; i < queryBindSubscriptions.length; i++) {
                queryBindSubscriptions[i].dispose();
            }
            queryBindSubscriptions = null;
        }
    }
    exports.unbindQuery = unbindQuery;

    exports.queryMappers = [];

    function MapToQuery(value) {
        for (var i = 0; i < exports.queryMappers.length; i++) {
            if (exports.queryMappers[i].acceptsValue(value)) {
                return exports.queryMappers[i].toQuery(value);
            }
        }

        return value;
    }
    exports.MapToQuery = MapToQuery;

    function MapFromQuery(queryValue, datatype) {
        if (datatype) {
            for (var i = 0; i < exports.queryMappers.length; i++) {
                if (exports.queryMappers[i].acceptsDatatype(datatype)) {
                    return exports.queryMappers[i].fromQuery(queryValue, datatype);
                }
            }
        }

        return queryValue;
    }
    exports.MapFromQuery = MapFromQuery;
});
//function registerQueryMappers() {
//    if (moment) {
//        registerMomentQueryMapper();
//    }
//}
//function registerMomentQueryMapper() {
//    var momentQueryMapper: QueryMapper<Moment> = {
//        acceptsValue: function (value) {
//            return moment.isMoment(value);
//        },
//        toQuery: function (value) {
//            return value.clone().utc().toISOString();
//        },
//        acceptsDatatype: function (datatype) {
//            return datatype.toLowerCase() == 'moment';
//        },
//        fromQuery: function (queryValue, datatype) {
//            if (queryValue) {
//                return moment.utc(queryValue).local();
//            } else {
//                return moment();
//            }
//        }
//    };
//    queryMappers.push(momentQueryMapper);
//}
//# sourceMappingURL=navigation.js.map
