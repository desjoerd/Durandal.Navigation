/// <reference path="../../typings/durandal/durandal.d.ts" />
/// <reference path="../../typings/knockout/knockout.d.ts" />

import _system = require("durandal/system");
import _router = require("plugins/router");

var setImmediate = setImmediate || setTimeout;

var routeStripper = /^[#\/]|\s+$/g;
var optionalParam = /\((.*?)\)/g;
var namedParam = /(\(\?)?:\w+/g;

var escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;
var splatParam = /\*\w+/g;

var knownRoutesChangeCount: number = 0;
var knownRoutes: DurandalRouteConfiguration[] = [];

export function install() {
    _router.on('router:route:after-config', onRouteAfterConfig);
    registerBindingHandlers();

    //registerQueryMappers();
}

function onRouteAfterConfig(route: DurandalRouteConfiguration, router: DurandalRouter) {
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
            ko.bindingHandlers.attr.update(
                element,
                function () { return { href: hash } },
                allBindings,
                viewModel,
                bindingContext);
        }
    };
}

export function hash(route: string = '', params: Object = {}, query: Object = {}): Hash {
    return new Hash(route, params, query);
}

export class Hash {
    private routeParamKeysCache: string[];
    private routePatternCache: RegExp;
    private routeConfigCache: DurandalRouteConfiguration[];
    private routeConfigCacheChangeCount: number;

    public route: KnockoutObservable<string>;
    public params: KnockoutObservable<Object>;
    public query: KnockoutObservable<Object>;

    public url: KnockoutComputed<string>;

    public isActiveRouteMatch: KnockoutComputed<boolean>;
    public isActiveParamsMatch: KnockoutComputed<boolean>;
    public isActiveQueryMatch: KnockoutComputed<boolean>;

    public constructor(route: string = '', params: Object = {}, query: Object = {}) {
        this.route = ko.observable(route);
        this.route.subscribe((newValue) => {
            this.routeParamKeysCache = null;
            this.routePatternCache = null;
            this.routeConfigCache = null;
        });

        this.params = ko.observable(params);
        this.query = ko.observable(query);

        this.url = ko.computed(() => {
            return buildHash(this.route(), this.params(), this.query());
        });

        this.isActiveRouteMatch = ko.computed(() => { return this.matchActiveRoute() });
        this.isActiveParamsMatch = ko.computed(() => { return this.matchActiveRoute() && this.matchActiveParams() });
        this.isActiveQueryMatch = ko.computed(() => { return this.matchActiveRoute() && this.matchActiveParams() && this.matchActiveQuery() });
    }

    private matchActiveRoute(): boolean {
        return this.getRouteConfigs().some((c) => {
            return c.isActive();
        });
    }

    private matchActiveParams(): boolean {
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
    }

    private matchActiveQuery(): boolean {
        var activeQuery = _router.activeInstruction().queryParams;
        var hashQuery = unwrapAttributes(this.query());

        if (activeQuery) {
            for (var attr in hashQuery) {
                // mapQuery
                hashQuery[attr] = MapToQuery(hashQuery[attr]);
                
                if (hashQuery[attr] && activeQuery[attr] != hashQuery[attr]) {
                    return false;
                }
            }
        }
        return true;
    }

    private getParamsAsArray(): any[] {
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
    }

    private getRouteConfigs(): DurandalRouteConfiguration[] {
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
    }

    private getRoutePattern() {
        return this.routePatternCache = this.routePatternCache
            || createRoutePattern(this.route());
    }

    private getRouteParamKeys() {
        return this.routeParamKeysCache = this.routeParamKeysCache
            || createRouteParamKeys(this.getRoutePattern(), this.route());
    }
}

export function buildHash(route: string, params: Object = {}, query: Object = {}): string {
    return _router.convertRouteToHash(buildUrl(route, params, query));
}

export function buildUrl(route: string, params: Object = {}, query: Object = {}): string {
    var unwrappedParams = unwrapAttributes(params);
    var unwrappedQuery = unwrapAttributes(query);

    // mapQuery
    for (var queryKey in unwrappedQuery) {
        unwrappedQuery[queryKey] = MapToQuery(unwrappedQuery[queryKey]);
    }

    return buildFragment(route, unwrappedParams) + buildQueryString(unwrappedQuery);
}

function buildFragment(route: string, params: Object): string {
    var fragment = route.replace(optionalParam, (match) => {
        var paramName = match.match(/\w+/)[0];
        var paramValue = params[paramName];
        if (paramValue) {
            return match.replace(/[()]/g, '');
        } else {
            return '';
        }
    }).replace(namedParam, (match) => {
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

function buildQueryString(query: Object): string {
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

function unwrapAttributes(obj: Object) {
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
    routeString = routeString.replace(escapeRegExp, '\\$&')
        .replace(optionalParam, '(?:$1)?')
        .replace(namedParam, function (match, optional) {
            return optional ? match : '([^\/]+)';
        })
        .replace(splatParam, '(.*?)');

    return new RegExp('^' + routeString + '$');
}

export function updateQuery(query: Object, trigger?: boolean): boolean;
export function updateQuery(query: Object, options: DurandalNavigationOptions): boolean;
export function updateQuery(query: Object, options: any, skipQueryMapping?: boolean): boolean {
    if (typeof options == 'undefined') {
        options = true;
    }

    if (!skipQueryMapping) {
        // mapQuery
        for (var queryKey in query) {
            query[queryKey] = MapToQuery(query[queryKey]);
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

var queryBindSubscriptions: KnockoutSubscription[];
var volatileQuery;
var volatileOptions;

export function bindQuery(config: Object) {
    unbindQuery();

    //TODO two way bind because of mapping

    queryBindSubscriptions = [];
    for (var queryAttr in config) {
        var bindQuerySetting = config[queryAttr];

        var navigationOptions: DurandalNavigationOptions;
        var queryObservable: KnockoutObservable<string>;
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
                newValue = MapToQuery(newValue);

                // check for double navigation
                if (_router.activeInstruction().queryParams &&
                    _router.activeInstruction().queryParams[this.property] == newValue) {

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


                    setImmediate(() => {
                        updateQuery(volatileQuery, volatileOptions);
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

export function unbindQuery() {
    if (queryBindSubscriptions) {
        for (var i = 0; i < queryBindSubscriptions.length; i++) {
            queryBindSubscriptions[i].dispose();
        }
        queryBindSubscriptions = null;
    }
}


export interface QueryMapper<T> {

    acceptsValue(value: any): boolean;
    toQuery(value: T): string;

    acceptsDatatype(datatype: string): boolean;
    fromQuery(queryValue: string, datatype:string): T;
}

export var queryMappers:QueryMapper<any>[] = [];

export function MapToQuery(value: any) {
    for (var i = 0; i < queryMappers.length; i++) {
        if (queryMappers[i].acceptsValue(value)) {
            return queryMappers[i].toQuery(value);
        }
    }

    return value;
}

export function MapFromQuery(queryValue: string, datatype: string):any {
    if (datatype) {
        for (var i = 0; i < queryMappers.length; i++) {
            if (queryMappers[i].acceptsDatatype(datatype)) {
                return queryMappers[i].fromQuery(queryValue, datatype);
            }
        }
    }

    return queryValue;
}

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