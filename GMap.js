/**
 * GMap类是利用shipxy.com提供的API开发的一个可以方便在页面中显示Google地图的类
 * 相比原生API这个类的使用更加方便
 * @author Runtian Zhai
 * @version 20170714.1701
 */

var GMap = {

    /**
     * GMap类的多线程操作
     * GMap中共有两个线程：操作线程和构造线程
     * 构造线程负责构造所有地图，操作线程负责操作对地图的指令
     * 当程序收到一个构造地图的请求时，该请求首先会被压入一个栈中，然后构造线程执行
     * 构造线程会逐一弹出栈中的请求并进行构造
     * 为了防止一个Map对象还没有准备好就对其进行操作，在Map还未准备好就收到操作指令时，
     * 程序会先将指令放进一个队列中，等全部地图准备完毕时逐一执行等待中的指令，
     * 这就保证了所有指令都会安全地执行
     */

    CMAP: shipxyMap.MapType.CMAP,
    GOOGLEMAP: shipxyMap.MapType.GOOGLEMAP,
    GOOGLESATELLITE: shipxyMap.MapType.GOOGLESATELLITE,
    POINT: shipxyMap.OverlayType.MARKER,
    POLYLINE: shipxyMap.OverlayType.POLYLINE,
    POLYGON: shipxyMap.OverlayType.POLYGON,
    creating: false,  // creating为true表示构造线程正在进行
    waitingStack: [],  // 存放等待构造的地图的栈
    workingQueue: [],  // 存放等待执行的操作的队列
    working: false,  // working为true表示操作线程正在进行
    maps: [],  // 存放已经构造好的地图的数组，需要注意这些地图可能还没有准备好
    mapcount: 0,  // 已经构造好的地图的数量
    readycount: 0,  // 已经准备好的地图的数量
    hiddenOverlays: [],  // 被隐藏的绘制物，一个保存Overlay对象的数组
    overlaysChanged: [],  // 在前一次操作中发生改变的绘制物，一个保存绘制物id的数组

    /**
     * 默认属性的定义
     */
    defaultStroke: new shipxyMap.StrokeStyle(),
    defaultFill: new shipxyMap.FillStyle(),
    defaultFont: new shipxyMap.FontStyle(),
    defaultPointUrl: 'http://www.runtianz.cn/img/point.png',

    mapLock: false,  // 地图锁
    onready: function() {},  // 忽视地图锁的指令

    /**
     * 锁上地图锁
     */
    lock: function() {
        GMap.mapLock = true;
    },

    /**
     * 一个异常类型，当用户尝试创建一个绘制物且该绘制物的id已经存在时会抛出此异常
     */
    IdAlreadyExistError: function() {
        this.message = 'The Id already exists.';
    },

    /**
     * 一个异常类型，当用户尝试对一个不存在的绘制物进行操作时会抛出此异常
     */
    IdNotExistError: function() {
        this.message = 'The Id does not exist.';
    },

    /**
     * 返回一个随机的长度大于10的字符串，私有方法
     * @returns 一个随机字符串
     */
    randomString: function() {
        return Math.random().toString(36).substr(2);
    },

    /**
     * 返回绘制物类型对应的编号，私有方法
     * @param type 绘制物类型
     * @returns 点对应0，折线对应1，多边形对应2
     */
    getTypeNumber: function(type) {
        switch (type) {
            case GMap.POINT:
                return 0;
            case GMap.POLYLINE:
                return 1;
            case GMap.POLYGON:
                return 2;
        }
    },

    /**
     * 从地图上和隐藏的绘制物中寻找某个特定的绘制物，私有方法
     * @param mapId 地图编号
     * @param id 绘制物的id
     * @returns 一个Overlay对象，表示该绘制物，如果没有找到则返回null
     */
    getOverlay: function(mapId, id) {
        var ans = GMap.maps[mapId].getOverlayById(id);
        if (ans)
            return ans;
        var objs = GMap.hiddenOverlays[mapId];
        for (var i = 0; i < 3; ++i)
            for (var j = 0; j < objs[i].length; ++j)
                if (objs[i][j].id === id)
                    return objs[i][j];
        return null;
    },

    /**
     * 从地图上和隐藏的绘制物中寻找某个类型的绘制物，私有方法
     * @param mapId 地图编号
     * @param type 绘制物的类型，三个类型常量之一
     * @returns 一个数组，包含所有找到的对象的id
     */
    getOverlayByType: function(mapId, type) {
        var objs = GMap.maps[mapId].getOverlayByType(type);
        var ans = [];
        for (var i = 0; i < objs.length; ++i)
            ans.push(objs[i].id);
        objs = GMap.hiddenOverlays[mapId][GMap.getTypeNumber(type)];
        for (var i = 0; i < objs.length; ++i)
            ans.push(objs[i].id);
        return ans;
    },

    /**
     * 检测groupFlag数组中有没有某个组合的id
     * @param id 组合的id
     */
    groupFlagContains: function(id) {
        for (var i = 0; i < GMap.groupFlag.length; ++i)
            if (GMap.groupFlag[i] === id)
                return true;
        return false;
    },

    /**
     * 当一个方法执行完毕后，触发所有事件监听器
     * @param mapId 地图的编号
     * @param operationId 指令的序号
     * @param args 参数列表
     * @param result 指令执行完毕后的返回值
     */
    handleEvents: function(mapId, operationId, args, result) {
        // 加载事件池，记录所有可能触发事件的对象的id
        var fun = GMap.eventPool[operationId];
        var ans = fun(mapId, args, result);
        var types = GMap.eventTypes[operationId];
        var obj = GMap.maps[mapId].getCenter();

        // 1.触发单例事件
        for (var i = 0; i < ans.length; ++i)
            for (var j = 0; j < types.length; ++j) {
                try {
                    if (GMap.registeredEvents[mapId][ans[i]][types[j]]) {
                        var arr = GMap.registeredEvents[mapId][ans[i]][types[j]];
                        for (var k = 0; k < arr.length; ++k) {
                            GMap.eventBank[arr[k]]({'lat': obj.lat, 'lng': obj.lng, 'id': ans[i]});
                        }
                    }
                } catch (err) {
                    // 这里在registeredEvents可能无法查询到相应类型的事件
                    // javascript会默认抛出一个TypeError，这里直接忽略这类异常
                    if (!err instanceof TypeError)
                        throw err;
                }
            }


        // 2.触发组合事件
        for (var i = 0; i < ans.length; ++i)
            for (var j = 0; j < types.length; ++j) {
                var groups = GMap.overlayBind[mapId][ans[i]];
                if (!groups)
                    continue;
                for (var k = 0; k < groups.length; ++k) {
                    if (GMap.groupFlagContains(groups[k]))
                        continue;
                    GMap.groupFlag.push(groups[k]);
                    try {
                        if (GMap.groupEvents[mapId][groups[k]][types[j]]) {
                            var arr = GMap.groupEvents[mapId][groups[k]][types[j]];
                            for (var l = 0; l < arr.length; ++l) {
                                GMap.eventBank[arr[l]]({'lat': obj.lat, 'lng': obj.lng, 'id': groups[k]});
                            }
                        }
                    } catch (err) {
                        if (!err instanceof TypeError)
                            throw err;
                    }
                }
            }

        // 3.处理onremove类型事件
        for (var i = 0; i < GMap.overlayRemoveEvent.length; ++i) {
            GMap.eventBank[GMap.overlayRemoveEvent[i][0]]({
                'lat': obj.lat, 'lng': obj.lng, 'id': GMap.overlayRemoveEvent[i][1]
            });
        }
        for (var i = 0; i < GMap.groupRemoveEvent.length; ++i) {
            if (GMap.groupFlagContains(GMap.groupRemoveEvent[i][0]))
                continue;
            GMap.groupFlag.push(GMap.groupRemoveEvent[i][0]);
            GMap.eventBank[GMap.groupRemoveEvent[i][0]]({
                'lat': obj.lat, 'lng': obj.lng, 'id': GMap.groupRemoveEvent[i][1]
            });
        }
        GMap.overlayRemoveEvent = [];
        GMap.groupRemoveEvent = [];

        if (!GMap.groupEventLock)
            GMap.groupFlag = [];
    },

    /**
     * 几个常用的事件池函数
     * 事件池函数的格式：function(mapId, args, result)
     */
    registeredEvents: [],  // 所有被注册的事件监听器，一个包含字典的数组
    eventBank: [],  // 事件银行，储存所有事件的钩子
    rawEventBank: [],  // 储存flash需要使用的事件的银行，为flash中绑定的事件提供钩子
    eventRemoved: [],  // 一个布尔型数组，记录一个事件是否已被移除，true表示已移除，事件已作废
    emptyEventPool: function() {return [];},  // 空事件池
    mapEventPool: function() {return ['__map__'];},  // 只包含全局地图的事件池
    overlayEventPool: function() {
        if (GMap.overlaysChanged.length === 0)
            return [];
        return GMap.overlaysChanged.concat(['__map__']);
    }, // 绘制物发生改变的事件池

    eventPool: [],  // 保存指令的事件池
    eventTypes: [],  // 指令需要触发的事件类型
    emptyEvent: function() {},  // 一个哨兵方法

    /**
     * 为一个对象注册事件监听器
     * @param mapId 地图的编号
     * @param objectId 要注册的对象的id，全局地图的id是__map__
     * @param events 保存事件的字典
     */
    registerEvent: function(mapId, objectId, events) {
        var objs = GMap.registeredEvents[mapId][objectId];
        if (!objs) {
            GMap.registeredEvents[mapId][objectId] = [];
            objs = GMap.registeredEvents[mapId][objectId];
        }
        for (var key in events) {
            GMap.eventBank.push(events[key]);
            GMap.rawEventBank.push(GMap.emptyEvent);
            GMap.eventRemoved.push(false);
            if (!objs[key])
                objs[key] = [];
            objs[key].push(GMap.eventBank.length - 1);
            GMap.registerSpecialEvent(mapId, objectId, key, GMap.eventBank.length - 1);
        }
    },

    /**
     * 为一个组合注册组合事件监听器
     * @param mapId 地图的编号
     * @param groupId 要注册的组合的id
     * @param events 保存事件的字典
     */
    registerGroupEvent: function(mapId, groupId, events) {
        var objs = GMap.groupEvents[mapId][groupId];
        for (var key in events) {
            GMap.eventBank.push(events[key]);
            GMap.rawEventBank.push(GMap.emptyEvent);
            GMap.eventRemoved.push(false);
            if (!objs[key])
                objs[key] = [];
            objs[key].push(GMap.eventBank.length - 1);
            GMap.registerSpecialGroupEvent(mapId, groupId, key, GMap.eventBank.length - 1);
        }
    },

    /**
     * 为一组对象注册集体事件监听器
     * @param mapId 地图的编号
     * @param group 一个数组，记录了一组对象的id
     * @param events 保存事件的字典
     */
    registerEventForArray: function(mapId, group, events) {
        for (var key in events) {
            GMap.eventBank.push(events[key]);
            GMap.rawEventBank.push(GMap.emptyEvent);
            GMap.eventRemoved.push(false);
            for (var i = 0; i < group.length; ++i) {
                var objs = GMap.registeredEvents[mapId][group[i]];
                if (!objs) {
                    GMap.registeredEvents[mapId][group[i]] = [];
                    objs = GMap.registeredEvents[mapId][group[i]];
                }
                if (!objs[key])
                    objs[key] = [];
                objs[key].push(GMap.eventBank.length - 1)
                GMap.registerSpecialEvent(mapId, group[i], key, GMap.eventBank.length - 1);
            }
        }
    },

    /**
     * 把字符串类型的事件类型名称转换为shipxy中api的类型
     * @param type 字符串类型的事件类型名称
     * @returns shipxy中api的类型，如果无法转换则返回null
     */
    getEventType: function(type) {
        var ans = null;
        switch (type) {
            case 'onchange':
                ans = shipxyMap.Event.MOVE_END;
                break;
            case 'onzoom':
                ans = shipxyMap.Event.ZOOM_CHANGED;
                break;
            case 'onchangemaptype':
                ans = shipxyMap.Event.MAPTYPE_CHANGED;
                break;
            case 'onclick':
                ans = shipxyMap.Event.CLICK;
                break;
            case 'ondoubleclick':
                ans = shipxyMap.Event.DOUBLE_CLICK;
                break;
            case 'onmousedown':
                ans = shipxyMap.Event.MOUSE_DOWN;
                break;
            case 'onmouseup':
                ans = shipxyMap.Event.MOUSE_UP;
                break;
            case 'onmousemove':
                ans = shipxyMap.Event.MOUSE_MOVE;
                break;
            case 'onmouseover':
                ans = shipxyMap.Event.MOUSE_OVER;
                break;
            case 'onmouseout':
                ans = shipxyMap.Event.MOUSE_OUT;
        }
        return ans;
    },

    /**
     * 在shipxy提供的api中注册事件
     * @param mapId 地图的编号
     * @param objectId 对象的id
     * @param type 事件的类型名称
     * @param eventId 事件在银行中的编号
     */
    registerSpecialEvent: function(mapId, objectId, type, eventId) {
        var ans = GMap.getEventType(type);
        if (!ans)
            return;
        if (objectId === '__map__') {
            GMap.rawEventBank[eventId] = function(event) {
                if (GMap.eventRemoved[eventId])
                    return;
                GMap.eventBank[eventId]({'lat': event.latLng.lat, 'lng': (event.latLng.lng < 0) ? (event.latLng.lng + 360) : event.latLng.lng, 'id': '__map__'});
            };
            GMap.maps[mapId].addEventListener(GMap.maps[mapId], ans, GMap.rawEventBank[eventId]);
        } else {
            if (ans === shipxyMap.Event.MOVE_END ||
                ans === shipxyMap.Event.ZOOM_CHANGED ||
                ans === shipxyMap.Event.MAPTYPE_CHANGED)
                return;
            GMap.rawEventBank[eventId] = function(event) {
                if (GMap.eventRemoved[eventId])
                    return;
                GMap.eventBank[eventId]({'lat': event.latLng.lat, 'lng': (event.latLng.lng < 0) ? (event.latLng.lng + 360) : event.latLng.lng, 'id': objectId});
            };
            GMap.maps[mapId].addEventListener(GMap.getOverlay(mapId, objectId), ans, GMap.rawEventBank[eventId]);
        }
    },

    /**
     * 在shipxy提供的api中注册一个组合事件
     * @param mapId 地图的编号
     * @param groupId 组合的id
     * @param type 事件的类型名称
     * @param eventId 事件在银行中的编号
     */
    registerSpecialGroupEvent: function(mapId, groupId, type, eventId) {
        var ans = GMap.getEventType(type);
        if (!ans)
            return;
        if (ans === shipxyMap.Event.MOVE_END ||
            ans === shipxyMap.Event.ZOOM_CHANGED ||
            ans === shipxyMap.Event.MAPTYPE_CHANGED)
            return;
        var res = GMap.getGroup(mapId, groupId);
        GMap.rawEventBank[eventId] = function(event) {
            if (GMap.eventRemoved[eventId])
                return;
            GMap.eventBank[eventId]({'lat': event.latLng.lat, 'lng': (event.latLng.lng < 0) ? (event.latLng.lng + 360) : event.latLng.lng, 'id': groupId});
        };
        for (var i = 1; i < res.length; ++i) {
            GMap.maps[mapId].addEventListener(GMap.getOverlay(mapId, res[i]), ans, GMap.rawEventBank[eventId]);
        }
    },

    overlayGroup: [],  // 记录组合的成员信息，每个数组的第一个元素总是组合的id
    overlayBind: [],  // 记录每一个绘制物在哪些组合里，每个元素都是一个字典
    groupEvents: [],  // 记录组合与组合事件的绑定，第一个元素总是组合的id
    groupEventsRemoved: [],  // 一个布尔型数组，记录哪些组合事件已被移除，true表示已被移除
    groupFlag:  [],  // 一个临时数组，存放当前阶段已经执行过的组合事件的组合的id

    overlayRemoveEvent: [],  // 一个临时存放绘制物删除事件的数组
    groupRemoveEvent: [],  // 一个临时存放组合删除事件的数组
    groupEventLock: false,  // 组合事件锁

    /**
     * 从一个地图中彻底销毁一个绘制物
     * @param mapId 地图的编号
     * @param id 绘制物的id
     */
    deleteOverlay: function(mapId, id) {
        // 1.先检查绘制物是否存在，不存在则返回
        if (!id || id === '__map__')
            return;
        var ans = GMap.getOverlay(mapId, id);
        if (!ans)
            return;
        var j = GMap.getTypeNumber(ans.type);
        var temp, k;

        // 2.检查绘制物有没有被隐藏，并作相应的删除
        var res = GMap.maps[mapId].getOverlayById(id);
        if (res)
            GMap.maps[mapId].removeOverlay(res);
        else {
            var i = 0;
            while (GMap.hiddenOverlays[mapId][j][i].id !== id)
                ++i;
            GMap.hiddenOverlays[mapId][j].splice(i, 1);
        }

        // 3.销毁绘制物的所有事件，并将onremove事件存放到临时数组中
        var objs = GMap.registeredEvents[mapId][id];
        if (objs) {
            if (objs['onremove']) {
                for (j = 0; j < objs['onremove'].length; ++j) {
                    GMap.overlayRemoveEvent.push([objs['onremove'][j], id]);
                }
            }
            GMap.registeredEvents[mapId][id] = [];
        }

        // 4.销毁绘制物的组合绑定记录，并将组合中的onremove事件存放到临时数组中
        var obj = GMap.overlayBind[mapId][id];
        if (obj) {
            for (j = 0; j < obj.length; ++j) {
                temp = GMap.getGroup(mapId, obj[j]);
                objs = GMap.groupEvents[mapId][obj[j]]['onremove'];
                if (objs) {
                    for (i = 0; i < objs.length; ++i) {
                        var p = true;
                        for (k = 0; k < GMap.groupRemoveEvent.length; ++k)
                            if (GMap.groupRemoveEvent[k][0] === objs[i])
                                p = false;
                        if (p)
                            GMap.groupRemoveEvent.push([objs[i], obj[j]]);
                    }
                }
                k = 1;
                while (k < temp.length && temp[k] !== id)
                    ++k;
                temp.splice(k, 1);
            }
            GMap.overlayBind[mapId][id] = [];
        }
    },

    /**
     * 获得一个绘制物组合
     * @param mapId 地图的编号
     * @param id 组合的id
     * @returns 一个数组，包含组名id和组合内成员的id，如果不存在则返回null
     */
    getGroup: function(mapId, id) {
        if(!id)
            return null;
        var ans = GMap.overlayGroup[mapId];
        var i = 0;
        while (i < ans.length && ans[i][0] !== id)
            ++i;
        if (i === ans.length)
            return null;
        else
            return ans[i];
    },

    /**
     * 给一个地图插入一个绘制物的组合
     * @param mapId 地图的编号
     * @param arr 一个包含绘制物id的数组，且第一个元素必须是该组合的id
     */
    setGroup: function(mapId, arr) {
        GMap.overlayGroup[mapId].push(arr);  // 把组合信息记录在overlayGroup数组中
        for (var i = 1; i < arr.length; ++i) {
            GMap.overlayBind[mapId][arr[i]].push(arr[0]);
        }  // 把每一个成员与组合绑定
        GMap.groupEvents[mapId][arr[0]] = [];  // 构造组合事件字典
    },

    /**
     * 删除一个绘制物的组合
     * @param mapId 地图的编号
     * @param id 组合的id
     * @returns 一个布尔值，表示这个组合原本是否存在，false表示不存在
     */
    deleteGroup: function(mapId, id) {
        if (!id)
            return false;
        var ans = GMap.overlayGroup[mapId];
        var i = 0;
        while (i < ans.length && ans[i][0] !== id)
            ++i;
        if (i === ans.length)
            return false;
        var j, obj, k;

        // 1.取消绘制物与组合之间的绑定
        for (j = 1; j < ans[i].length; ++j) {
            obj = GMap.overlayBind[mapId][ans[i][j]];
            if (obj) {
                k = 0;
                while (k < obj.length && obj[k] !== ans[i][0])
                    ++k;
                if (k < obj.length)
                    obj.splice(k, 1);
            }
        }

        // 2.从记录中删除组合
        GMap.overlayGroup[mapId].splice(i, 1);
        return true;
    },

    /**
     * 在页面的一个元素内显示地图，并返回该地图的实例
     * @param objectId 必选项，用于显示地图的元素的id
     * @param centerLat 可选项，地图中心点的纬度，范围为-90到90，正数表示北纬，默认为30，即北纬30度
     * @param centerLng 可选项，地图中心点的经度，范围为0到360，小于180表示东经，默认为120，即东经120度
     * @param zoom 可选项，地图缩放级别，取值为1~18内的整数，值越大地图显示范围越小，默认为5
     * @param mapType 可选项，地图的类型，GMap.CMAP是海图,
     *        GMap.GOOGLEMAP是地图，GMap.GOOGLESATELLITE是卫星图，默认为GMap.GOOGLEMAP
     *        地图类型的三个常量（取值为其中一个）
     *        GMap.CMAP
     *        GMap.GOOGLEMAP
     *        GMap.GOOGLESATELLITE
     */
    Map: function(objectId) {
        GMap.waitingStack.push([GMap.mapcount, arguments]);
        GMap.maps.push(null);
        if (!GMap.creating)  // 如果构造地图线程没有运行则运行它
            GMap.createMap();
        /**
         * 开发者须知：
         * 为了保证Map对象的方法的线程安全性，在这里定义的所有方法的方法体全是虚的
         * 这里的定义只是为了提供一个给应用程序使用的接口
         * 真正的方法体全部定义在GMap.fireEvent方法中
         * 先由GMap.prepareEvent方法检测当前地图是否已经准备完毕
         * 然后由GMap.prepareEvent方法来调用GMap.fireEvent方法
         * 一定不要在GMap.prepareEvent之外的地方调用GMap.fireEvent方法!
         */
        var amap = {
            id: GMap.mapcount,  // 表示地图在maps数组中的序号

            /**
             * 切换地图的中心点以及缩放级别
             * @param centerLat 必选项，地图中心点的纬度
             * @param centerLng 必选项，地图中心点的经度
             * @param zoom 可选项，地图的缩放级别，默认为5
             */
            setCenter: function(centerLat, centerLng) {
                // 指令序号0
                GMap.prepareEvent(this.id, 0, arguments);
            },

            /**
             * 切换地图的缩放级别
             * @param zoom 必选项，地图的缩放级别
             */
            setZoom: function(zoom) {
                // 指令序号1
                GMap.prepareEvent(this.id, 1, arguments);
            },

            /**
             * 切换地图类型
             * @param mapType 必选项，地图的类型
             */
            setMapType: function(mapType) {
                // 指令序号2
                GMap.prepareEvent(this.id, 2, arguments);
            },

            /**
             * 返回一个二元数组，表示当前地图中心的经纬度，前一个是纬度，后一个是经度
             * @returns 当前地图中心的经纬度
             */
            getCenter: function() {
                // 指令序号3
                return GMap.prepareEvent(this.id, 3, arguments);
            },

            /**
             * 返回地图的缩放级别
             * @returns 地图的缩放级别
             */
            getZoom: function() {
                // 指令序号4
                return GMap.prepareEvent(this.id, 4, arguments);
            },

            /**
             * 返回地图的类型，取值为三个地图类型常量中的一个
             * @returns 地图的类型
             */
            getMapType: function() {
                // 指令序号5
                return GMap.prepareEvent(this.id, 5, arguments);
            },

            /**
             * 返回一个二元数组，表示地图所显示的区域的像素大小，前一个是宽度值，后一个是高度值
             * @returns 当前地图显示区域的像素大小
             */
            getSize: function() {
                // 指令序号6
                return GMap.prepareEvent(this.id, 6, arguments);
            },

            /**
             * 返回一个四元数组，表示当前地图所显示的区域的经纬度范围
             * 这个四元数组是[southWestLat, southWestLng, northEastLat, northEastLng]
             * 分别表示了西南角的经纬度以及东北角的经纬度
             * @returns [southWestLat, southWestLng, northEastLat, northEastLng]
             *          southWestLat 地图所显示区域西南角的纬度
             *          southWestLng 地图所显示区域西南角的经度
             *          northEastLat 地图所显示区域东北角的纬度
             *          northEastLng 地图所显示区域东北角的经度
             */
            getBounds: function() {
                // 指令序号7
                return GMap.prepareEvent(this.id, 7, arguments);
            },

            /**
             * 按像素向东、向南平移地图
             * @param east 地图向东方的平移像素数，可以为负（即向西平移）
             * @param south 地图向南方的平移像素数，可以为负（即向北平移）
             */
            translate: function(east, south) {
                // 指令序号8
                GMap.prepareEvent(this.id, 8, arguments);
            },

            /**
             * 输入一个经纬度，返回此经纬度对应的点在屏幕上的像素坐标
             * 其中，地图的最左上角的坐标是(0,0)
             * @param lat 点的纬度
             * @param lng 点的经度
             * @returns 一个二元数组，表示这个点在屏幕上的像素坐标，前一个是水平方向，后一个是竖直方向
             */
            fromLatLngToPoint: function(lat, lng) {
                // 指令序号9
                return GMap.prepareEvent(this.id, 9, arguments);
            },

            /**
             * 输入一个屏幕上的点的像素坐标，返回这个点对应的经纬度
             * @param x 点的水平像素坐标
             * @param y 点的竖直像素坐标
             * @returns 一个二元数组，表示这个点的经纬度，前一个是纬度，后一个是经度
             */
            fromPointToLatLng: function(x, y) {
                // 指令序号10
                return GMap.prepareEvent(this.id, 10, arguments);
            },

            /**
             * 在地图上绘制一个点
             * @param id 必选项，点的id，一个字符串
             *           如果该id已经存在，则会抛出一个GMap.IdAlreadyExistError类型的异常
             *           如果传入null，程序会分配一个随机字符串作为该绘制物的id
             * @param lat 必选项，点的纬度
             * @param lng 必选项，点的经度
             * @param label 可选项，一个Label实例，用于在点上显示标签，如为null则不显示标签，默认为null
             * @param imageUrl 可选项，点的图片的URL，如果不选或为null则默认为默认值
             * @param zoomlevels 可选项，一个二元数组[low, high]，只有当地图的缩放级别在区间
             *                  [low, high]之内时这个点才会显示，默认为[1,18]
             * @param zIndex 可选项，绘制物的堆叠层级，默认为3
             * @param imagePosX 可选项，绘制的点相对于指定点的水平偏移量，以向右为正方向，默认为0
             * @param imagePosY 可选项，绘制的点相对于指定点的竖直偏移量，以向下为正方向，默认为0
             * @param isEditable 可选项，表示点是否可以拖动，true表示可以拖动，默认为false
             * @returns 点的id
             */
            addPoint: function(id, lat, lng) {
                // 指令序号11
                return GMap.prepareEvent(this.id, 11, arguments);
            },

            /**
             * 在地图上绘制一条折线
             * @param id 必选项，折线的id，一个字符串
             *           如果该id已经存在，则会抛出一个GMap.IdAlreadyExistError类型的异常
             *           如果传入null，程序会分配一个随机字符串作为该绘制物的id
             * @param data 必选项，一个数组，其中每一个元素都是一个二元数组[lat, lng]，表示一个节点的信息
             *             lat 节点的纬度
             *             lng 节点的经度
             * @param stroke 可选项，线条的样式，一个Stroke实例，如为null则采用默认线条样式，默认为null
             * @param label 可选项，一个Label实例，用于在折线上显示标签，如为null则不显示标签，默认为null
             * @param zoomlevels 可选项，一个二元数组[low, high]，只有当地图的缩放级别在区间
             *                  [low, high]之内时这条折线才会显示，默认为[1,18]
             * @param zIndex 可选项，绘制物的堆叠层级，默认为3
             * @param isEditable 可选项，表示折线是否可以拖动，true表示可以拖动，默认为false
             * @returns 折线的id
             */
            addPolyline: function(id, data) {
                // 指令序号12
                return GMap.prepareEvent(this.id, 12, arguments);
            },

            /**
             * 在地图上绘制一个多边形
             * @param id 必选项，多边形的id，一个字符串
             *           如果该id已经存在，则会抛出一个GMap.IdAlreadyExistError类型的异常
             *           如果传入null，程序会分配一个随机字符串作为该绘制物的id
             * @param data 必选项，一个数组，其中每一个元素都是一个二元数组[lat, lng]，表示一个顶点的信息
             *             lat 节点的纬度
             *             lng 节点的经度
             * @param stroke 可选项，多边形的边的线条样式，一个Stroke实例，如为null则采用默认线条样式，默认为null
             * @param fill 可选项，多边形的填充样式，一个Fill实例，如为null则采用默认填充样式，默认为null
             * @param label 可选项，一个Label实例，用于在多边形上显示标签，如为null则不显示标签，默认为null
             * @param zoomlevels 可选项，一个二元数组[low, high]，只有当地图的缩放级别在区间
             *                  [low, high]之内时这个多边形才会显示，默认为[1,18]
             * @param zIndex 可选项，绘制物的堆叠层级，默认为3
             * @param isEditable 可选项，表示多边形是否可以拖动，true表示可以拖动，默认为false
             * @returns 多边形的id
             */
            addPolygon: function(id, data) {
                // 指令序号13
                return GMap.prepareEvent(this.id, 13, arguments);
            },

            /**
             * 返回一个绘制物的类型，取值为三个类型常量之一
             * @param id 绘制物的id
             * @returns 绘制物的类型，如果id不存在则抛出GMap.IdNotExistError类型的异常
             */
            getType: function(id) {
                // 指令序号14
                return GMap.prepareEvent(this.id, 14, arguments);
            },

            /**
             * 返回地图上存在的，同一个类型的全部绘制物
             * @param type 绘制物的类型，取值为三个类型常量之一
             * @returns 一个数组，包含所有此类绘制物的id
             */
            getByType: function(type) {
                // 指令序号15
                return GMap.prepareEvent(this.id, 15, arguments);
            },

            /**
             * 移动地图，使得某一个绘制物成为中心点，并改变地图的缩放级别
             * @param id 必选项，绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @param zoom 可选项，地图新的缩放级别，如果不选，如果是点类绘制物则不改变缩放级别，
             *             如果是折线或者多边形，则会按照其范围自动修改到合适的缩放级别
             */
            locate: function(id) {
                // 指令序号16
                GMap.prepareEvent(this.id, 16, arguments);
            },

            /**
             * 删除一个绘制物，可以删除已隐藏的绘制物
             * @param id 要删除的绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             */
            remove: function(id) {
                // 指令序号17
                GMap.prepareEvent(this.id, 17, arguments);
            },

            /**
             * 删除地图上存在的，某一个类型的全部绘制物，包括已经隐藏的绘制物
             * @param type 绘制物的类型，取值为三个类型常量之一
             * @returns 一个整数，成功删除的绘制物的个数
             */
            removeByType: function(type) {
                // 指令序号18
                return GMap.prepareEvent(this.id, 18, arguments);
            },

            /**
             * 删除地图上存在的所有绘制物，包括已经隐藏的绘制物
             * @returns 一个整数，成功删除的绘制物的个数
             */
            removeAll: function() {
                // 指令序号19
                return GMap.prepareEvent(this.id, 19, arguments);
            },

            /**
             * 隐藏一个绘制物并返回是否成功，如果该绘制物已经隐藏则视为不成功，但不会抛出异常
             * @param id 要隐藏的绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个布尔值，是否成功隐藏该绘制物
             */
            hide: function(id) {
                // 指令序号20
                return GMap.prepareEvent(this.id, 20, arguments);
            },

            /**
             * 隐藏地图上某一个类型的全部绘制物，返回成功隐藏的绘制物的个数
             * @param type 绘制物的类型，取值为三个类型常量之一
             * @returns 被隐藏的绘制物的个数，不包括原先就已经隐藏了的
             */
            hideByType: function(type) {
                // 指令序号21
                return GMap.prepareEvent(this.id, 21, arguments);
            },

            /**
             * 隐藏地图上的全部绘制物，返回成功隐藏的绘制物的个数
             * @returns 被隐藏的绘制物的个数，不包括原先就已经隐藏了的
             */
            hideAll: function() {
                // 指令序号22
                return GMap.prepareEvent(this.id, 22, arguments);
            },

            /**
             * 显示一个被隐藏的绘制物，返回是否成功显示，如果该绘制物没有被隐藏则视为不成功
             * 但不会抛出异常
             * @param id 要显示的绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个布尔值，绘制物是否成功显示
             */
            show: function(id) {
                // 指令序号23
                return GMap.prepareEvent(this.id, 23, arguments);
            },

            /**
             * 在地图上显示全部被隐藏的某一个类型的绘制物，返回被显示的绘制物的数量
             * @param type 绘制物的类型，取值为三个类型常量之一
             * @returns 一个整数，被显示的绘制物的数量，不包括已经显示在地图上的
             */
            showByType: function(type) {
                // 指令序号24
                return GMap.prepareEvent(this.id, 24, arguments);
            },

            /**
             * 在地图上显示所有被隐藏的绘制物，返回被显示的绘制物的数量
             * @returns 一个整数，被显示的绘制物的数量，不包括已经显示在地图上的
             */
            showAll: function() {
                // 指令序号25
                return GMap.prepareEvent(this.id, 25, arguments);
            },

            /**
             * 返回某一个绘制物是否被隐藏了
             * @param id 绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个布尔值，true表示该绘制物被隐藏
             */
            isHidden: function(id) {
                // 指令序号26
                return GMap.prepareEvent(this.id, 26, arguments);
            },

            /**
             * 为当前地图注册一系列事件监听器
             * @param events 一个字典，保存了一组事件监听器
             */
            addMapEvent: function(events) {
                // 指令序号27
                GMap.prepareEvent(this.id, 27, arguments);
            },

            /**
             * 为某一个绘制物注册一系列事件监听器
             * @param id 绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @param events 一个字典，保存了一组事件监听器
             */
            addOverlayEvent: function(id, events) {
                // 指令序号28
                GMap.prepareEvent(this.id, 28, arguments);
            },

            /**
             * 为某一个类型的全部绘制物注册一系列事件监听器
             * @param type 绘制物的类型，取值为三个类型常量之一
             * @param events 一个字典，保存了一组事件监听器
             */
            addOverlayEventByType: function(type, events) {
                // 指令序号29
                GMap.prepareEvent(this.id, 29, arguments);
            },

            /**
             * 为所有绘制物注册事件监听器
             * @param events 一个字典，保存了一组事件监听器
             */
            addOverlayEventToAll: function(events) {
                // 指令序号30
                GMap.prepareEvent(this.id, 30, arguments);
            },

            /**
             * 删除某一类型的全部地图事件
             * @param type 一个字符串，类型名
             */
            removeMapEvent: function(type) {
                // 指令序号31
                GMap.prepareEvent(this.id, 31, arguments);
            },

            /**
             * 删除一个绘制物的某一类型的全部绘制物事件
             * @param id 绘制物的id，如果id不存在则抛出GMap.IdNotExistError类型的异常
             * @param type 一个字符串，类型名
             */
            removeOverlayEvent: function(id, type) {
                // 指令序号32
                GMap.prepareEvent(this.id, 32, arguments);
            },

            /**
             * 删除一类绘制物的某一类型的全部绘制物事件
             * @param overlayType 绘制物的类型，取值为三个类型常量之一
             * @param eventType 一个字符串，事件的类型名
             */
            removeOverlayEventByType: function(overlayType, eventType) {
                // 指令序号33
                GMap.prepareEvent(this.id, 33, arguments);
            },

            /**
             * 删除某一类型的全部绘制物事件
             * @param type 一个字符串，事件的类型名
             */
            removeAllOverlayEvent: function(type) {
                // 指令序号34
                GMap.prepareEvent(this.id, 34, arguments);
            },

            /**
             * 组合一组绘制物
             * @param id 组合的id，如为null则系统分配一个随机字符串作为组合的id
             *           如果该id已经存在，则会抛出一个GMap.IdAlreadyExistError类型的异常
             * @param idArray 一个绘制物id的数组，包含要组合的绘制物
             *                只要其中任意一个id不存在，就会抛出GMap.IdNotExistError类型的异常
             * @returns 一个字符串，组合的id
             */
            group: function(id, idArray) {
                // 指令序号35
                return GMap.prepareEvent(this.id, 35, arguments);
            },

            /**
             * 删除一个绘制物组合，如果这个组合不存在也不会抛出异常，而是以返回值来指示
             * @param id 要删除的组合的id
             * @returns 一个布尔值，组合原本是否存在，false表示组合原本不存在
             */
            ungroup: function(id) {
                // 指令序号36
                return GMap.prepareEvent(this.id, 36, arguments);
            },

            /**
             * 返回一个绘制物组合中的所有绘制物的id
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个数组，包含组合中所有绘制物的id
             */
            getGroup: function(id) {
                // 指令序号37
                return GMap.prepareEvent(this.id, 37, arguments);
            },

            /**
             * 移除一个组合内的所有绘制物，然后删除这个组合
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             */
            removeGroup: function(id) {
                // 指令序号38
                GMap.prepareEvent(this.id, 38, arguments);
            },

            /**
             * 隐藏一个组合内的所有绘制物
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个整数，表示成功被隐藏的绘制物的个数
             */
            hideGroup: function(id) {
                // 指令序号39
                return GMap.prepareEvent(this.id, 39, arguments);
            },

            /**
             * 显示一个组合内的所有绘制物
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @returns 一个整数，表示成功被显示的绘制物的个数
             */
            showGroup: function(id) {
                // 指令序号40
                return GMap.prepareEvent(this.id, 40, arguments);
            },

            /**
             * 定位一个组合内的绘制物，系统首先计算出一个囊括整个组合的大矩形，然后把地图中心点设为矩形中心
             * 这里包括被隐藏的绘制物
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @param zoom 可选项，定位后显示的缩放级别，如果不选则由系统自动计算一个合适的缩放级别
             */
            locateGroup: function(id) {
                // 指令序号41
                GMap.prepareEvent(this.id, 41, arguments);
            },

            /**
             * 为一个绘制物组合注册一系列组合事件监听器
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @param events 一个字典，保存了一组事件监听器
             */
            addGroupEvent: function(id, events) {
                // 指令序号42
                GMap.prepareEvent(this.id, 42, arguments);
            },

            /**
             * 删除一个绘制物组合的某一类型的全部事件
             * @param id 组合的id，如果该id不存在则抛出GMap.IdNotExistError类型的异常
             * @param type 一个字符串，事件的类型名称
             */
            removeGroupEvent: function(id, type) {
                // 指令序号43
                GMap.prepareEvent(this.id, 43, arguments);
            },

            /**
             * 运行一个函数，函数内的所有代码对组合事件视为同时执行
             * @param fun 一个函数
             * @returns 函数的运行结果
             */
            run: function(fun) {
                // 指令序号44
                return GMap.prepareEvent(this.id, 44, arguments);
            }
        };
        ++GMap.mapcount;
        GMap.hiddenOverlays.push([[], [], []]);
        GMap.registeredEvents.push({'__map__': []});
        GMap.overlayGroup.push([]);
        GMap.groupEvents.push([]);
        GMap.overlayBind.push({'__map__': []});
        return amap;
    },

    /**
     * 返回一个标签实例
     * @param text 必选项，标签上要显示的文字
     * @param labelPosX 可选项，标签相对绘制物的水平偏移量，以向右为正方向，默认为0
     * @param labelPosY 可选项，标签相对绘制物的竖直偏移量，以向下为正方向，默认为0
     * @param font 可选项，一个Font实例，表示标签中文字的字体，默认为默认字体
     * @param href 可选项，标签中文字的超链接地址，如果为null则没有超链接，默认为null
     * @param backgroundFill 可选项，一个Fill实例，表示标签的背景填充样式，如果为null则无背景，默认为null
     * @param borderStroke 可选项，一个Stroke实例，表示标签的边框线条样式，如果为null则无边框，默认为null
     */
    Label: function(text) {
        var option = new shipxyMap.LabelOptions();
        if (arguments[4])
            option.htmlText = '<a href="'+ arguments[4] +'">' + text + '</a>';
        else
            option.text = text;
        var x = 0;
        if (arguments[1])
            x = arguments[1];
        var y = 0;
        if (arguments[2])
            y = arguments[2];
        option.labelPosition = new shipxyMap.Point(x, y);
        if (arguments[3])
            option.fontStyle = arguments[3];
        else
            option.fontStyle = GMap.defaultFont;
        if (arguments[5]) {
            option.backgroundStyle = arguments[5];
            option.background = true;
        }
        if (arguments[6])
            option.borderStyle = arguments[6];
        else
            option.border = false;
        return option;
    },

    /**
     * 返回一个字体属性对象实例
     * @param family 字体名称，如"Calibri"或"宋体"，如果是null则使用默认值
     * @param size 字体大小，单位为像素，如果是null则使用默认值
     * @param color 字体颜色，取值为0x00000~0xFFFFFF，如果是null则使用默认值
     * @param bold 布尔类型，表示是否加粗，true表示加粗
     * @param italic 布尔类型，表示是否斜体，true表示斜体
     * @param underline 布尔类型，表示是否有下划线，true表示有下划线
     */
    Font: function() {
        var ans = new shipxyMap.FontStyle();
        ans.name = arguments[0] || GMap.defaultFont.name;
        ans.size = arguments[1] || GMap.defaultFont.size;
        ans.color = arguments[2] || GMap.defaultFont.color;
        if (arguments[3])
            ans.bold = arguments[3];
        else
            ans.bold = GMap.defaultFont.bold;
        if (arguments[4])
            ans.italic = arguments[4];
        else
            ans.italic = GMap.defaultFont.italic;
        if (arguments[5])
            ans.underline = arguments[5];
        else
            ans.underline = GMap.defaultFont.underline;
        return ans;
    },

    /**
     * 返回一个线条属性对象实例
     * @param thickness 线条的粗细，单位为像素，如果是null则使用默认值
     * @param color 线条的颜色，取值为0x00000~0xFFFFFF，如果是null则使用默认值
     * @param alpha 线条的透明度，取值为0.0~1.0,1.0表示不透明，如果是null则使用默认值
     */
    Stroke: function() {
        var ans = new shipxyMap.StrokeStyle();
        ans.thickness = arguments[0] || GMap.defaultStroke.thickness;
        ans.color = arguments[1] || GMap.defaultStroke.color;
        ans.alpha = arguments[2] || GMap.defaultStroke.alpha;
        return ans;
    },

    /**
     * 返回一个填充属性对象实例
     * @param color 填充颜色，取值为0x00000~0xFFFFFF，如果是null则使用默认值
     * @param alpha 填充透明度，取值为0.0~1.0,1.0表示不透明，如果是null则使用默认值
     */
    Fill: function() {
        var ans = new shipxyMap.FillStyle();
        ans.color = arguments[0] || GMap.defaultFill.color;
        ans.alpha = arguments[1] || GMap.defaultFill.alpha;
        return ans;
    },

    /**
     * 改变字体属性的默认值为传入的Font实例
     * 初始默认值为Verdana, 11px, 黑色(0x000000), 非粗体，非斜体，没有下划线
     * @param font 一个Font实例
     */
    setDefaultFont: function(font) {
        // 深复制
        GMap.defaultFont = new GMap.Font(font.name, font.size, font.color, font.bold,
            font.italic, font.underline);
    },

    /**
     * 改变线条属性的默认值为传入的Stroke实例
     * 初始默认值为粗细1px，颜色黑色(0x000000)，完全不透明(1.0)
     * @param stroke 一个Stroke实例
     */
    setDefaultStroke: function(stroke) {
        // 深复制
        GMap.defaultStroke = new GMap.Stroke(stroke.thickness, stroke.color, stroke.alpha);
    },

    /**
     * 改变填充属性的默认值为传入的Fill实例
     * 初始默认值为颜色黑色(0x000000)，完全不透明(1.0)
     * @param fill 一个Fill实例
     */
    setDefaultFill: function(fill) {
        // 深复制
        GMap.defaultFill = new GMap.Fill(fill.color, fill.alpha);
    },

    /**
     * 改变绘制点时采用的默认图片的url
     * @param url 一个字符串，新的url
     */
    setDefaultPointUrl: function(url) {
        GMap.defaultPointUrl = url;
    },

    /**
     * 开始构造地图的线程
     */
    createMap: function() {
        if (GMap.creating)
            return;
        GMap.creating = true;
        while (true) {
            var mapOptions = new shipxyMap.MapOptions();
            var arg = GMap.waitingStack.pop();
            var args = arg[1];
            mapOptions.center = new shipxyMap.LatLng(args[1] || 30, args[2] || 120);
            mapOptions.zoom = args[3] || 5;
            mapOptions.mapType = args[4] || GMap.GOOGLEMAP;
            GMap.maps[arg[0]] = new shipxyMap.Map(args[0], mapOptions);
            GMap.maps[arg[0]].mapId = arg[0];  // 地图在maps数组中的序号
            if (GMap.waitingStack.length === 0) {
                GMap.creating = false;  // 如果所有地图都构造完毕则结束线程
                break;
            }
        }
    },

    /**
     * 通知所有等待中的操作线程某一个地图已经准备完毕
     * @param id 已经准备完毕的地图序号
     */
    startWork: function(id) {
        var i;
        for (i = 0; i < GMap.workingQueue.length; ++i) {
            var arg = GMap.workingQueue[i];
            // 注意：当处理等待队列中的指令时，不能够直接调用fireEvent方法
            // 这会导致事件监听器得不到触发，同时也不能保证线程的安全性
            for (var j = 0; j < arg[2].length; ++j) {
                if (arg[2][j] instanceof GMap.ResultToken)
                    arg[2][j] = GMap.resultBank[arg[2][j].id];
            }
            GMap.resultBank[i] = GMap.prepareEvent(arg[0], arg[1], arg[2]);
        }
        GMap.workingQueue.splice(0, i);
        GMap.resultBank.splice(0, i);
    },

    resultBank: [],  // 用于存放临时中间结果的银行，凭ResultToken从中获取信息

    /**
     * 用于获取指令执行结果的令牌对象，由于指令的执行结果可能无法立即获取
     * 因此会先暂时返回一个令牌，等到可以获取时再凭此令牌取出结果
     */
    ResultToken: function(id) {
        this.id = id;
    },

    /**
     * 执行一个指令或将指令加入等待队列中，在其执行完毕后触发事件监听器
     * 如果指令被加入等待队列，则会返回一个GMap.ResultToken对象
     * 当指令被执行之后，就可以用这个对象去获取指令执行后的结果
     * @param mapId 地图编号
     * @param operationId 操作指令
     * @param args 操作的参数数组
     * @returns 指令执行的结果，或者一个结果GMap.ResultToken对象
     */
    prepareEvent: function(mapId, operationId, args) {
        if (GMap.readycount === GMap.mapcount) {
            var ans = GMap.fireEvent(mapId, operationId, args);
            GMap.handleEvents(mapId, operationId, args, ans);
            return ans;
        }
        else {
            GMap.workingQueue.push([mapId, operationId, args]);
            return new GMap.ResultToken(GMap.workingQueue.length - 1);
        }
    },

    /**
     * 根据指定的地图编号和操作指令进行操作
     * @param mapId 地图编号
     * @param operationId 操作指令
     * @param args 操作的参数数组
     */
    fireEvent: function(mapId, operationId, args) {
        switch (operationId) {
            case 0:  // setCenter
            {
                var zoom = args[2] || 5;
                GMap.maps[mapId].setCenter(new shipxyMap.LatLng(args[0], args[1]), zoom);
                break;
            }

            case 1:  // setZoom
            {
                GMap.maps[mapId].setZoom(args[0]);
                break;
            }

            case 2:  // setMapType
            {
                GMap.maps[mapId].setMapType(args[0]);
                break;
            }

            case 3:  // getCenter
            {
                var ans = GMap.maps[mapId].getCenter();
                while (ans.lng < 0)
                    ans.lng += 360;
                return [ans.lat, ans.lng];
            }

            case 4:  // getZoom
            {
                return GMap.maps[mapId].getZoom();
            }

            case 5:  // getMapType
            {
                return GMap.maps[mapId].getMapType();
            }

            case 6:  // getSize
            {
                var ans = GMap.maps[mapId].getSize();
                return [ans.width, ans.height];
            }

            case 7:  // getBounds
            {
                var ans = GMap.maps[mapId].getLatLngBounds();
                return [ans.southWest.lat, ans.southWest.lng, ans.northEast.lat, ans.northEast.lng];
            }

            case 8:  // translate
            {
                GMap.maps[mapId].panBy(new shipxyMap.Size(args[0], args[1]));
                break;
            }

            case 9:  // fromLatLngToPoint
            {
                var ans = GMap.maps[mapId].fromLatLngToPoint(new shipxyMap.LatLng(args[0], args[1]));
                while (ans.x < 0)
                    ans.x += 2050;
                while (ans.x > 2050)
                    ans.x -= 2050;
                return [ans.x, ans.y];
            }

            case 10:  // fromPointToLatLng
            {
                var ans = GMap.maps[mapId].fromPointToLatLng(new shipxyMap.Point(args[0], args[1]));
                if (ans.lng < 0)
                    ans.lng += 360;
                return [ans.lat, ans.lng];
            }

            case 11:  // addPoint
            {
                var pointId = null;
                if (args[0]) {
                    if (GMap.getOverlay(mapId, args[0]) || args[0] === '__map__')
                        throw new GMap.IdAlreadyExistError();
                    pointId = args[0];
                } else {
                    while(true){
                        pointId = GMap.randomString();
                        if (!GMap.getOverlay(mapId, pointId))
                            break;
                    }
                }
                var option = new shipxyMap.MarkerOptions();
                if (args[5])
                    option.zoomlevels = args[5];
                if (args[6])
                    option.zIndex = args[6];
                var x = 0;
                if (args[7])
                    x = args[7];
                var y = 0;
                if (args[8])
                    y = args[8];
                option.imagePos = new shipxyMap.Point(x, y);
                if (args[3]) {
                    option.labelOptions = args[3];
                    option.isShowLabel = true;
                }
                if (args[9])
                    option.isEditable = args[9];
                option.imageUrl = args[4] || GMap.defaultPointUrl;
                var ans = new shipxyMap.Marker(pointId, new shipxyMap.LatLng(args[1], args[2]), option);
                GMap.maps[mapId].addOverlay(ans, true);
                GMap.overlayBind[mapId][pointId] = [];
                return pointId;
            }

            case 12:  // addPolyline
            {
                var lineId = null;
                if (args[0]) {
                    if (GMap.getOverlay(mapId, args[0]))
                        throw new GMap.IdAlreadyExistError();
                    lineId = args[0];
                } else {
                    while(true) {
                        lineId = GMap.randomString();
                        if (!GMap.getOverlay(mapId, lineId))
                            break;
                    }
                }
                var option = new shipxyMap.PolylineOptions();
                if (args[4])
                    option.zoomlevels = args[4];
                if (args[5])
                    option.zIndex = args[5];
                if (args[2])
                    option.strokeStyle = args[2];
                else
                    option.strokeStyle = GMap.defaultStroke;
                if (args[3]) {
                    option.isShowLabel = true;
                    option.labelOptions = args[3];
                }
                if (args[6])
                    option.isEditable = args[6];
                var points = [];
                for (var i = 0; i < args[1].length; ++i) {
                    points.push(new shipxyMap.LatLng(args[1][i][0], args[1][i][1]));
                }
                var ans = new shipxyMap.Polyline(lineId, points, option);
                GMap.maps[mapId].addOverlay(ans, true);
                GMap.overlayBind[mapId][lineId] = [];
                return lineId;
            }

            case 13:  // addPolygon
            {
                var polygonId = null;
                if (args[0]) {
                    if (GMap.getOverlay(mapId, args[0]))
                        throw new GMap.IdAlreadyExistError();
                    polygonId = args[0];
                } else {
                    while (true) {
                        polygonId = GMap.randomString();
                        if (!GMap.getOverlay(mapId, polygonId))
                            break;
                    }
                }
                var option = new shipxyMap.PolygonOptions();
                if (args[5])
                    option.zoomlevels = args[5];
                if (args[6])
                    option.zIndex = args[6];
                if (args[2])
                    option.strokeStyle = args[2];
                else
                    option.strokeStyle = GMap.defaultStroke;
                if (args[3])
                    option.fillStyle = args[3];
                else
                    option.fillStyle = GMap.defaultFill;
                if (args[4]) {
                    option.isShowLabel = true;
                    option.labelOptions = args[4];
                }
                if (args[7])
                    option.isEditable = args[7];
                var points = [];
                for (var i = 0; i < args[1].length; ++i) {
                    points.push(new shipxyMap.LatLng(args[1][i][0], args[1][i][1]));
                }
                var ans = new shipxyMap.Polygon(polygonId, points, option);
                GMap.maps[mapId].addOverlay(ans, true);
                GMap.overlayBind[mapId][polygonId] = [];
                return polygonId;
            }

            case 14:  // getType
            {
                var ans = GMap.getOverlay(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                return ans.type;
            }

            case 15:  // getByType
            {
                return GMap.getOverlayByType(mapId, args[0]);
            }

            case 16:  // locate
            {
                var ans = GMap.getOverlay(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                if (args[1])
                    GMap.maps[mapId].locateOverlay(ans, args[1]);
                else
                    GMap.maps[mapId].locateOverlay(ans);
                break;
            }

            case 17:  // remove
            {
                var ans = GMap.getOverlay(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                GMap.deleteOverlay(mapId, args[0]);
                break;
            }

            case 18:  // removeByType
            {
                var objs = GMap.getOverlayByType(mapId, args[0]);
                var ans = objs.length;
                for (var i = 0; i < objs.length; ++i)
                    GMap.deleteOverlay(mapId, objs[i]);
                return ans;
            }

            case 19:  // removeAll
            {
                var ans = 0;
                var objs = GMap.getOverlayByType(mapId, GMap.POINT);
                ans += objs.length;
                for (var i = 0; i < objs.length; ++i)
                    GMap.deleteOverlay(mapId, objs[i]);
                objs = GMap.getOverlayByType(mapId, GMap.POLYLINE);
                ans += objs.length;
                for (var i = 0; i < objs.length; ++i)
                    GMap.deleteOverlay(mapId, objs[i]);
                objs = GMap.getOverlayByType(mapId, GMap.POLYGON);
                ans += objs.length;
                for (var i = 0; i < objs.length; ++i)
                    GMap.deleteOverlay(mapId, objs[i]);
                return ans;
            }

            case 20:  // hide
            {
                GMap.overlaysChanged = [];
                var ans = GMap.maps[mapId].getOverlayById(args[0]);
                if (ans) {
                    GMap.hiddenOverlays[mapId][GMap.getTypeNumber(ans.type)].push(ans);
                    GMap.maps[mapId].removeOverlay(ans);
                    GMap.overlaysChanged = [args[0]];
                    return true;
                } else {
                    ans = GMap.getOverlay(mapId, args[0]);
                    if (!ans)
                        throw new GMap.IdNotExistError();
                    return false;
                }
            }

            case 21:  // hideByType
            {
                GMap.overlaysChanged = [];
                var objs = GMap.maps[mapId].getOverlayByType(args[0]);
                var ans = objs.length;
                var res = GMap.hiddenOverlays[mapId][GMap.getTypeNumber(args[0])];
                for (var i = 0; i < objs.length; ++i) {
                    res.push(objs[i]);
                    GMap.maps[mapId].removeOverlay(objs[i]);
                    GMap.overlaysChanged.push(objs[i].id);
                }
                return ans;
            }

            case 22:  // hideAll
            {
                GMap.overlaysChanged = [];
                var objs = GMap.maps[mapId].getOverlayByType(GMap.POINT);
                var ans = objs.length;
                var res = GMap.hiddenOverlays[mapId][0];
                for (var i = 0; i < objs.length; ++i) {
                    res.push(objs[i]);
                    GMap.maps[mapId].removeOverlay(objs[i]);
                    GMap.overlaysChanged.push(objs[i].id);
                }
                objs = GMap.maps[mapId].getOverlayByType(GMap.POLYLINE);
                ans += objs.length;
                res = GMap.hiddenOverlays[mapId][1];
                for (var i = 0; i < objs.length; ++i) {
                    res.push(objs[i]);
                    GMap.maps[mapId].removeOverlay(objs[i]);
                    GMap.overlaysChanged.push(objs[i].id);
                }
                objs = GMap.maps[mapId].getOverlayByType(GMap.POLYGON);
                ans += objs.length;
                res = GMap.hiddenOverlays[mapId][2];
                for (var i = 0; i < objs.length; ++i) {
                    res.push(objs[i]);
                    GMap.maps[mapId].removeOverlay(objs[i]);
                    GMap.overlaysChanged.push(objs[i].id);
                }
                return ans;
            }

            case 23:  // show
            {
                GMap.overlaysChanged = [];
                var ans = GMap.maps[mapId].getOverlayById(args[0]);
                if (ans) {
                    return false;
                } else {
                    ans = GMap.getOverlay(mapId, args[0]);
                    if (!ans)
                        throw new GMap.IdNotExistError();
                    var t = GMap.getTypeNumber(ans.type);
                    var objs = GMap.hiddenOverlays[mapId][t];
                    var i = 0;
                    while (objs[i].id !== args[0])
                        ++i;
                    GMap.maps[mapId].addOverlay(ans, true);
                    GMap.overlaysChanged = [ans.id];
                    objs.splice(i, 1);
                    return true;
                }
            }

            case 24:  // showByType
            {
                GMap.overlaysChanged = [];
                var objs = GMap.hiddenOverlays[mapId][GMap.getTypeNumber(args[0])];
                var ans = objs.length;
                for (var i = 0; i < ans; ++i) {
                    GMap.maps[mapId].addOverlay(objs[i], true);
                    GMap.overlaysChanged.push(objs[i].id);
                }
                GMap.hiddenOverlays[mapId][GMap.getTypeNumber(args[0])] = [];
                return ans;
            }

            case 25:  // showAll
            {
                GMap.overlaysChanged = [];
                var ans = 0;
                for (var i = 0; i < 3; ++i) {
                    ans += GMap.hiddenOverlays[mapId][i].length;
                    for (var j = 0; j < GMap.hiddenOverlays[mapId][i].length; ++j) {
                        GMap.maps[mapId].addOverlay(GMap.hiddenOverlays[mapId][i][j], true);
                        GMap.overlaysChanged.push(GMap.hiddenOverlays[mapId][i][j].id);
                    }
                    GMap.hiddenOverlays[mapId][i] = [];
                }
                return ans;
            }

            case 26:  // isHidden
            {
                var ans = GMap.getOverlay(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                var res = GMap.maps[mapId].getOverlayById(args[0]);
                return (!res);
            }

            case 27:  // addMapEvent
            {
                GMap.registerEvent(mapId, '__map__', args[0]);
                break;
            }

            case 28:  // addOverlayEvent
            {
                var ans = GMap.getOverlay(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                GMap.registerEvent(mapId, args[0], args[1]);
                break;
            }

            case 29:  // addOverlayEventByType
            {
                var ans = GMap.getOverlayByType(mapId, args[0]);
                GMap.registerEventForArray(mapId, ans, args[1]);
                break;
            }

            case 30:  // addOverlayEventToAll
            {
                var ans = GMap.getOverlayByType(mapId, GMap.POINT);
                ans = ans.concat(GMap.getOverlayByType(mapId, GMap.POLYLINE));
                ans = ans.concat(GMap.getOverlayByType(mapId, GMap.POLYGON));
                GMap.registerEventForArray(mapId, ans, args[0]);
                break;
            }

            case 31:  // removeMapEvent
            {
                var ans = GMap.registeredEvents[mapId]['__map__'][args[0]];
                var res = GMap.getEventType(args[0]);
                if (res) {
                    for (var i = 0; i < ans.length; ++i) {
                        GMap.eventRemoved[ans[i]] = true;
                    }
                }
                GMap.registeredEvents[mapId]['__map__'][args[0]] = [];
                break;
            }

            case 32:  // removeOverlayEvent
            {
                var obj = GMap.getOverlay(mapId, args[0]);
                if (!obj)
                    throw new GMap.IdNotExistError();
                ans = GMap.registeredEvents[mapId][args[0]][args[1]];
                var res = GMap.getEventType(args[1]);
                if (res) {
                    for (var i = 0; i < ans.length; ++i) {
                        GMap.eventRemoved[ans[i]] = true;
                    }
                }
                GMap.registeredEvents[mapId][args[0]][args[1]] = [];
                break;
            }

            case 33:  // removeOverlayEventByType
            {
                var objs = GMap.getOverlayByType(mapId, args[0]);
                var ans;
                var res = GMap.getEventType(args[1]);
                for (var i = 0; i < objs.length; ++i) {
                    ans = GMap.registeredEvents[mapId][objs[i]][args[1]];
                    if (res) {
                        for (var j = 0; j < ans.length; ++j) {
                            GMap.eventRemoved[ans[j]] = true;
                        }
                    }
                    GMap.registeredEvents[mapId][objs[i]][args[1]] = [];
                }
                break;
            }

            case 34:  // removeAllOverlayEvent
            {
                var objs = GMap.getOverlayByType(mapId, GMap.POINT);
                objs = objs.concat(GMap.getOverlayByType(mapId, GMap.POLYLINE));
                objs = objs.concat(GMap.getOverlayByType(mapId, GMap.POLYGON));
                var ans;
                var res = GMap.getEventType(args[0]);
                for (var i = 0; i < objs.length; ++i) {
                    ans = GMap.registeredEvents[mapId][objs[i]][args[0]];
                    if (res) {
                        for (var j = 0; j < ans.length; ++j) {
                            GMap.eventRemoved[ans[j]] = true;
                        }
                    }
                    GMap.registeredEvents[mapId][objs[i]][args[0]] = [];
                }
                break;
            }

            case 35:  // group
            {
                var ans, res = args[0];
                if (args[0]) {
                    ans = GMap.getGroup(mapId, args[0]);
                    if (ans)
                        throw new GMap.IdAlreadyExistError();
                } else {
                    res = GMap.randomString();
                    while(GMap.getGroup(mapId, res))
                        res = GMap.randomString();
                }
                ans = [res];
                for (var i = 0; i < args[1].length; ++i) {
                    if (!GMap.getOverlay(mapId, args[1][i]))
                        throw new GMap.IdNotExistError();
                }
                ans = ans.concat(args[1]);
                GMap.setGroup(mapId, ans);
                return res;
            }

            case 36:  // ungroup
            {
                return GMap.deleteGroup(mapId, args[0]);
            }

            case 37:  // getGroup
            {
                var ans = GMap.getGroup(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                var res = [];  // 深复制
                for (var i = 1; i < ans.length; ++i)
                    res.push(ans[i]);
                return res;
            }

            case 38:  // removeGroup
            {
                var res = GMap.getGroup(mapId, args[0]);
                if (!res)
                    throw new GMap.IdNotExistError();
                var ans = [];  // 这里一定要深复制
                var i;
                for (i = 0; i < res.length; ++i)
                    ans.push(res[i]);
                for (i = 1; i < ans.length; ++i) {
                    GMap.deleteOverlay(mapId, ans[i]);
                }
                GMap.deleteGroup(mapId, args[0]);
                break;
            }

            case 39:  // hideGroup
            {
                GMap.overlaysChanged = [];
                var res = GMap.getGroup(mapId, args[0]);
                if (!res)
                    throw new GMap.IdNotExistError();
                var t = 0;
                for (var i = 1; i < res.length; ++i) {
                    var ans = GMap.maps[mapId].getOverlayById(res[i]);
                    if (ans) {
                        GMap.hiddenOverlays[mapId][GMap.getTypeNumber(ans.type)].push(ans);
                        GMap.maps[mapId].removeOverlay(ans);
                        GMap.overlaysChanged.push(ans.id);
                        ++t;
                    }
                }
                return t;
            }

            case 40:  // showGroup
            {
                GMap.overlaysChanged = [];
                var res = GMap.getGroup(mapId, args[0]);
                if (!res)
                    throw new GMap.IdNotExistError();
                var t = 0;
                for (var i = 1; i < res.length; ++i) {
                    var ans = GMap.getOverlay(mapId, res[i]);
                    if (!GMap.maps[mapId].getOverlayById(res[i])) {
                        var objs = GMap.hiddenOverlays[mapId][GMap.getTypeNumber(ans.type)];
                        var j = 0;
                        while (objs[j].id !== res[i])
                            ++j;
                        objs.splice(j, 1);
                        GMap.maps[mapId].addOverlay(ans, true);
                        GMap.overlaysChanged.push(ans.id);
                        ++t;
                    }
                }
                return t;
            }

            case 41:  // locateGroup
            {
                var ans = GMap.getGroup(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                var res = [];
                for (var i = 1; i < ans.length; ++i)
                    res.push(GMap.getOverlay(mapId, ans[i]));
                if (args[1])
                    GMap.maps[mapId].locateOverlays(res, args[1]);
                else
                    GMap.maps[mapId].locateOverlays(res);
                break;
            }

            case 42:  // addGroupEvent
            {
                var ans = GMap.getGroup(mapId, args[0]);
                if (!ans)
                    throw new GMap.IdNotExistError();
                GMap.registerGroupEvent(mapId, args[0], args[1]);
                break;
            }

            case 43:  // removeGroupEvent
            {
                var obj = GMap.getGroup(mapId, args[0]);
                if (!obj)
                    throw new GMap.IdNotExistError();
                ans = GMap.groupEvents[mapId][args[0]][args[1]];
                var res = GMap.getEventType(args[1]);
                if (res) {
                    for (var i = 0; i < ans.length; ++i) {
                        GMap.eventRemoved[ans[i]] = true;
                    }
                }
                GMap.groupEvents[mapId][args[0]][args[1]] = [];
                break;
            }

            case 44:  // run
            {
                GMap.groupEventLock = true;
                var ans;
                try {
                    ans = args[0]();
                } finally {
                    GMap.groupEventLock = false;
                    GMap.groupFlag = [];
                }
                return ans;
            }
        }

        return null;  // 默认情况下所有指令的返回结果为null
    }

};

shipxyMap.mapReady = function() {
    ++GMap.readycount;
    if (GMap.readycount === GMap.mapcount) { // 当所有地图准备完毕时
        if (GMap.mapLock)
            GMap.workingQueue = [];
        else
            GMap.startWork(); // 通知所有等待中的对该地图的操作线程
        GMap.onready();
    }
};

/**
 * 一个装有事件池函数的数组，输入一个指令序号，返回一个数组，记录需要触发的事件池
 * 注意：有些可以在shipxy的api中注册的事件就不在这里注册
 * 注意：onremove事件不在这里注册，有专门的方法处理这些事件
 */
GMap.eventPool = [
    GMap.emptyEventPool,  // setCenter
    GMap.emptyEventPool,  // setZoom
    GMap.emptyEventPool,  // setMapType
    GMap.emptyEventPool,  // getCenter
    GMap.emptyEventPool,  // getZoom
    GMap.emptyEventPool,  // getMapType
    GMap.emptyEventPool,  // getSize
    GMap.emptyEventPool,  // getBounds
    GMap.emptyEventPool,  // translate
    GMap.emptyEventPool,  // fromLatLngToPoint
    GMap.emptyEventPool,  // fromPointToLatLng
    GMap.mapEventPool,  // addPoint
    GMap.mapEventPool,  // addPolyline
    GMap.mapEventPool,  // addPolygon
    GMap.emptyEventPool,  // getType
    GMap.emptyEventPool,  // getByType
    GMap.emptyEventPool,  // locate
    GMap.emptyEventPool,  // remove
    GMap.emptyEventPool,  // removeByType
    GMap.emptyEventPool,  // removeAll
    GMap.overlayEventPool,  // hide
    GMap.overlayEventPool,  // hideByType
    GMap.overlayEventPool,  // hideAll
    GMap.overlayEventPool,  // show
    GMap.overlayEventPool,  // showByType
    GMap.overlayEventPool,  // showAll
    GMap.emptyEventPool,  // isHidden
    GMap.emptyEventPool,  // addMapEvent
    GMap.emptyEventPool,  // addOverlayEvent
    GMap.emptyEventPool,  // addOverlayEventByType
    GMap.emptyEventPool,  // addOverlayEventToAll
    GMap.emptyEventPool,  // removeMapEvent
    GMap.emptyEventPool,  // removeOverlayEvent
    GMap.emptyEventPool,  // removeOverlayEventByType
    GMap.emptyEventPool,  // removeAllOverlayEvent
    GMap.emptyEventPool,  // group
    GMap.emptyEventPool,  // ungroup
    GMap.emptyEventPool,  // getGroup
    GMap.emptyEventPool,  // removeGroup
    GMap.overlayEventPool,  // hideGroup
    GMap.overlayEventPool,  // showGroup
    GMap.emptyEventPool,  // locateGroup
    GMap.emptyEventPool,  // addGroupEvent
    GMap.emptyEventPool,  // removeGroupEvent
    GMap.emptyEventPool  // run
];

GMap.eventTypes = [
    [],  // setCenter
    [],  // setZoom
    [],  // setMapType
    [],  // getCenter
    [],  // getZoom
    [],  // getMapType
    [],  // getSize
    [],  // getBounds
    [],  // translate
    [],  // fromLatLngToPoint
    [],  // fromPointToLatLng
    ['onadd'],  // addPoint
    ['onadd'],  // addPolyline
    ['onadd'],  // addPolygon
    [],  // getType
    [],  // getByType
    [],  // locate
    [],  // remove
    [],  // removeByType
    [],  // removeAll
    ['onhide'],  // hide
    ['onhide'],  // hideByType
    ['onhide'],  // hideAll
    ['onshow'],  // show
    ['onshow'],  // showByType
    ['onshow'],  // showAll
    [],  // isHidden
    [],  // addMapEvent
    [],  // addOverlayEvent
    [],  // addOverlayEventByType
    [],  // addOverlayEventToAll
    [],  // removeMapEvent
    [],  // removeOverlayEvent
    [],  // removeOverlayEventByType
    [],  // removeAllOverlayEvent
    [],  // group
    [],  // ungroup
    [],  // getGroup
    [],  // removeGroup
    ['onhide'],  // hideGroup
    ['onshow'],  // showGroup
    [],  // locateGroup
    [],  // addGroupEvent
    [],  // removeGroupEvent
    []  // run
];
