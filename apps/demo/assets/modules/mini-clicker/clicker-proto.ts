// @ts-nocheck
// 由 scripts/gen-ts.mjs 生成，勿手改。改 proto 后跑 pnpm gen。
/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import $protobuf from "protobufjs/minimal.js";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["game.clicker"] || ($protobuf.roots["game.clicker"] = {});

const $ns_game = $root.game = (() => {

    /**
     * Namespace game.
     * @exports game
     * @namespace
     */
    const game = {};

    game.clicker = (function() {

        /**
         * Namespace clicker.
         * @memberof game
         * @namespace
         */
        const clicker = {};

        clicker.v1 = (function() {

            /**
             * Namespace v1.
             * @memberof game.clicker
             * @namespace
             */
            const v1 = {};

            v1.ClickRequest = (function() {

                /**
                 * Properties of a ClickRequest.
                 * @memberof game.clicker.v1
                 * @interface IClickRequest
                 * @property {number|null} [count] ClickRequest count
                 */

                /**
                 * Constructs a new ClickRequest.
                 * @memberof game.clicker.v1
                 * @classdesc Represents a ClickRequest.
                 * @implements IClickRequest
                 * @constructor
                 * @param {game.clicker.v1.IClickRequest=} [properties] Properties to set
                 */
                function ClickRequest(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * ClickRequest count.
                 * @member {number} count
                 * @memberof game.clicker.v1.ClickRequest
                 * @instance
                 */
                ClickRequest.prototype.count = 0;

                /**
                 * Creates a new ClickRequest instance using the specified properties.
                 * @function create
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {game.clicker.v1.IClickRequest=} [properties] Properties to set
                 * @returns {game.clicker.v1.ClickRequest} ClickRequest instance
                 */
                ClickRequest.create = function create(properties) {
                    return new ClickRequest(properties);
                };

                /**
                 * Encodes the specified ClickRequest message. Does not implicitly {@link game.clicker.v1.ClickRequest.verify|verify} messages.
                 * @function encode
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {game.clicker.v1.IClickRequest} message ClickRequest message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ClickRequest.encode = function encode(message, writer, q) {
                    if (!writer)
                        writer = $Writer.create();
                    if (q === undefined)
                        q = 0;
                    if (q > $util.recursionLimit)
                        throw Error("max depth exceeded");
                    if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                        writer.uint32(/* id 1, wireType 1 =*/9).double(message.count);
                    return writer;
                };

                /**
                 * Encodes the specified ClickRequest message, length delimited. Does not implicitly {@link game.clicker.v1.ClickRequest.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {game.clicker.v1.IClickRequest} message ClickRequest message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ClickRequest.encodeDelimited = function encodeDelimited(message, writer) {
                    return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
                };

                /**
                 * Decodes a ClickRequest message from the specified reader or buffer.
                 * @function decode
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {game.clicker.v1.ClickRequest} ClickRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ClickRequest.decode = function decode(reader, length, error, long) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (long === undefined)
                        long = 0;
                    if (long > $Reader.recursionLimit)
                        throw Error("maximum nesting depth exceeded");
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.game.clicker.v1.ClickRequest();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.count = reader.double();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7, long);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Decodes a ClickRequest message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {game.clicker.v1.ClickRequest} ClickRequest
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ClickRequest.decodeDelimited = function decodeDelimited(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a ClickRequest message.
                 * @function verify
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                ClickRequest.verify = function verify(message, long) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (long === undefined)
                        long = 0;
                    if (long > $util.recursionLimit)
                        return "maximum nesting depth exceeded";
                    if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                        if (typeof message.count !== "number")
                            return "count: number expected";
                    return null;
                };

                /**
                 * Creates a ClickRequest message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {game.clicker.v1.ClickRequest} ClickRequest
                 */
                ClickRequest.fromObject = function fromObject(object, long) {
                    if (object instanceof $root.game.clicker.v1.ClickRequest)
                        return object;
                    if (!$util.isObject(object))
                        throw TypeError(".game.clicker.v1.ClickRequest: object expected");
                    if (long === undefined)
                        long = 0;
                    if (long > $util.recursionLimit)
                        throw Error("maximum nesting depth exceeded");
                    let message = new $root.game.clicker.v1.ClickRequest();
                    if (object.count != null)
                        message.count = Number(object.count);
                    return message;
                };

                /**
                 * Creates a plain object from a ClickRequest message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {game.clicker.v1.ClickRequest} message ClickRequest
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                ClickRequest.toObject = function toObject(message, options, q) {
                    if (!options)
                        options = {};
                    if (q === undefined)
                        q = 0;
                    if (q > $util.recursionLimit)
                        throw Error("max depth exceeded");
                    let object = {};
                    if (options.defaults)
                        object.count = 0;
                    if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                        object.count = options.json && !isFinite(message.count) ? String(message.count) : message.count;
                    return object;
                };

                /**
                 * Converts this ClickRequest to JSON.
                 * @function toJSON
                 * @memberof game.clicker.v1.ClickRequest
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                ClickRequest.prototype.toJSON = function toJSON() {
                    return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the default type url for ClickRequest
                 * @function getTypeUrl
                 * @memberof game.clicker.v1.ClickRequest
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ClickRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/game.clicker.v1.ClickRequest";
                };

                return ClickRequest;
            })();

            v1.ClickResponse = (function() {

                /**
                 * Properties of a ClickResponse.
                 * @memberof game.clicker.v1
                 * @interface IClickResponse
                 * @property {kit.v1.ErrorCode|null} [code] ClickResponse code
                 * @property {number|null} [total] ClickResponse total
                 */

                /**
                 * Constructs a new ClickResponse.
                 * @memberof game.clicker.v1
                 * @classdesc Represents a ClickResponse.
                 * @implements IClickResponse
                 * @constructor
                 * @param {game.clicker.v1.IClickResponse=} [properties] Properties to set
                 */
                function ClickResponse(properties) {
                    if (properties)
                        for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                            if (properties[keys[i]] != null && keys[i] !== "__proto__")
                                this[keys[i]] = properties[keys[i]];
                }

                /**
                 * ClickResponse code.
                 * @member {kit.v1.ErrorCode} code
                 * @memberof game.clicker.v1.ClickResponse
                 * @instance
                 */
                ClickResponse.prototype.code = 0;

                /**
                 * ClickResponse total.
                 * @member {number} total
                 * @memberof game.clicker.v1.ClickResponse
                 * @instance
                 */
                ClickResponse.prototype.total = 0;

                /**
                 * Creates a new ClickResponse instance using the specified properties.
                 * @function create
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {game.clicker.v1.IClickResponse=} [properties] Properties to set
                 * @returns {game.clicker.v1.ClickResponse} ClickResponse instance
                 */
                ClickResponse.create = function create(properties) {
                    return new ClickResponse(properties);
                };

                /**
                 * Encodes the specified ClickResponse message. Does not implicitly {@link game.clicker.v1.ClickResponse.verify|verify} messages.
                 * @function encode
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {game.clicker.v1.IClickResponse} message ClickResponse message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ClickResponse.encode = function encode(message, writer, q) {
                    if (!writer)
                        writer = $Writer.create();
                    if (q === undefined)
                        q = 0;
                    if (q > $util.recursionLimit)
                        throw Error("max depth exceeded");
                    if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.code);
                    if (message.total != null && Object.hasOwnProperty.call(message, "total"))
                        writer.uint32(/* id 2, wireType 1 =*/17).double(message.total);
                    return writer;
                };

                /**
                 * Encodes the specified ClickResponse message, length delimited. Does not implicitly {@link game.clicker.v1.ClickResponse.verify|verify} messages.
                 * @function encodeDelimited
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {game.clicker.v1.IClickResponse} message ClickResponse message or plain object to encode
                 * @param {$protobuf.Writer} [writer] Writer to encode to
                 * @returns {$protobuf.Writer} Writer
                 */
                ClickResponse.encodeDelimited = function encodeDelimited(message, writer) {
                    return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
                };

                /**
                 * Decodes a ClickResponse message from the specified reader or buffer.
                 * @function decode
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @param {number} [length] Message length if known beforehand
                 * @returns {game.clicker.v1.ClickResponse} ClickResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ClickResponse.decode = function decode(reader, length, error, long) {
                    if (!(reader instanceof $Reader))
                        reader = $Reader.create(reader);
                    if (long === undefined)
                        long = 0;
                    if (long > $Reader.recursionLimit)
                        throw Error("maximum nesting depth exceeded");
                    let end = length === undefined ? reader.len : reader.pos + length, message = new $root.game.clicker.v1.ClickResponse();
                    while (reader.pos < end) {
                        let tag = reader.uint32();
                        if (tag === error)
                            break;
                        switch (tag >>> 3) {
                        case 1: {
                                message.code = reader.int32();
                                break;
                            }
                        case 2: {
                                message.total = reader.double();
                                break;
                            }
                        default:
                            reader.skipType(tag & 7, long);
                            break;
                        }
                    }
                    return message;
                };

                /**
                 * Decodes a ClickResponse message from the specified reader or buffer, length delimited.
                 * @function decodeDelimited
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                 * @returns {game.clicker.v1.ClickResponse} ClickResponse
                 * @throws {Error} If the payload is not a reader or valid buffer
                 * @throws {$protobuf.util.ProtocolError} If required fields are missing
                 */
                ClickResponse.decodeDelimited = function decodeDelimited(reader) {
                    if (!(reader instanceof $Reader))
                        reader = new $Reader(reader);
                    return this.decode(reader, reader.uint32());
                };

                /**
                 * Verifies a ClickResponse message.
                 * @function verify
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {Object.<string,*>} message Plain object to verify
                 * @returns {string|null} `null` if valid, otherwise the reason why it is not
                 */
                ClickResponse.verify = function verify(message, long) {
                    if (typeof message !== "object" || message === null)
                        return "object expected";
                    if (long === undefined)
                        long = 0;
                    if (long > $util.recursionLimit)
                        return "maximum nesting depth exceeded";
                    if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                        switch (message.code) {
                        default:
                            return "code: enum value expected";
                        case 0:
                        case 1:
                        case 1000:
                        case 1001:
                        case 1002:
                        case 1003:
                        case 2000:
                        case 2001:
                        case 2002:
                        case 2003:
                        case 2004:
                        case 3000:
                        case 3001:
                        case 3002:
                        case 3003:
                        case 4000:
                        case 4001:
                        case 4002:
                        case 4003:
                            break;
                        }
                    if (message.total != null && Object.hasOwnProperty.call(message, "total"))
                        if (typeof message.total !== "number")
                            return "total: number expected";
                    return null;
                };

                /**
                 * Creates a ClickResponse message from a plain object. Also converts values to their respective internal types.
                 * @function fromObject
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {Object.<string,*>} object Plain object
                 * @returns {game.clicker.v1.ClickResponse} ClickResponse
                 */
                ClickResponse.fromObject = function fromObject(object, long) {
                    if (object instanceof $root.game.clicker.v1.ClickResponse)
                        return object;
                    if (!$util.isObject(object))
                        throw TypeError(".game.clicker.v1.ClickResponse: object expected");
                    if (long === undefined)
                        long = 0;
                    if (long > $util.recursionLimit)
                        throw Error("maximum nesting depth exceeded");
                    let message = new $root.game.clicker.v1.ClickResponse();
                    switch (object.code) {
                    default:
                        if (typeof object.code === "number") {
                            message.code = object.code;
                            break;
                        }
                        break;
                    case "ERROR_CODE_UNSPECIFIED":
                    case 0:
                        message.code = 0;
                        break;
                    case "ERROR_CODE_OK":
                    case 1:
                        message.code = 1;
                        break;
                    case "ERROR_CODE_PROTO_VERSION_MISMATCH":
                    case 1000:
                        message.code = 1000;
                        break;
                    case "ERROR_CODE_BAD_FRAME":
                    case 1001:
                        message.code = 1001;
                        break;
                    case "ERROR_CODE_UNKNOWN_CMD":
                    case 1002:
                        message.code = 1002;
                        break;
                    case "ERROR_CODE_NOT_HANDSHAKED":
                    case 1003:
                        message.code = 1003;
                        break;
                    case "ERROR_CODE_UNAUTHENTICATED":
                    case 2000:
                        message.code = 2000;
                        break;
                    case "ERROR_CODE_SESSION_EXPIRED":
                    case 2001:
                        message.code = 2001;
                        break;
                    case "ERROR_CODE_KICKED":
                    case 2002:
                        message.code = 2002;
                        break;
                    case "ERROR_CODE_BIND_CONFLICT":
                    case 2003:
                        message.code = 2003;
                        break;
                    case "ERROR_CODE_BANNED":
                    case 2004:
                        message.code = 2004;
                        break;
                    case "ERROR_CODE_MAINTENANCE":
                    case 3000:
                        message.code = 3000;
                        break;
                    case "ERROR_CODE_RATE_LIMITED":
                    case 3001:
                        message.code = 3001;
                        break;
                    case "ERROR_CODE_INTERNAL":
                    case 3002:
                        message.code = 3002;
                        break;
                    case "ERROR_CODE_UPSTREAM_UNAVAILABLE":
                    case 3003:
                        message.code = 3003;
                        break;
                    case "ERROR_CODE_NOT_FOUND":
                    case 4000:
                        message.code = 4000;
                        break;
                    case "ERROR_CODE_ALREADY_DONE":
                    case 4001:
                        message.code = 4001;
                        break;
                    case "ERROR_CODE_EXPIRED":
                    case 4002:
                        message.code = 4002;
                        break;
                    case "ERROR_CODE_INVALID_ARGUMENT":
                    case 4003:
                        message.code = 4003;
                        break;
                    }
                    if (object.total != null)
                        message.total = Number(object.total);
                    return message;
                };

                /**
                 * Creates a plain object from a ClickResponse message. Also converts values to other types if specified.
                 * @function toObject
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {game.clicker.v1.ClickResponse} message ClickResponse
                 * @param {$protobuf.IConversionOptions} [options] Conversion options
                 * @returns {Object.<string,*>} Plain object
                 */
                ClickResponse.toObject = function toObject(message, options, q) {
                    if (!options)
                        options = {};
                    if (q === undefined)
                        q = 0;
                    if (q > $util.recursionLimit)
                        throw Error("max depth exceeded");
                    let object = {};
                    if (options.defaults) {
                        object.code = options.enums === String ? "ERROR_CODE_UNSPECIFIED" : 0;
                        object.total = 0;
                    }
                    if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                        object.code = options.enums === String ? $root.kit.v1.ErrorCode[message.code] === undefined ? message.code : $root.kit.v1.ErrorCode[message.code] : message.code;
                    if (message.total != null && Object.hasOwnProperty.call(message, "total"))
                        object.total = options.json && !isFinite(message.total) ? String(message.total) : message.total;
                    return object;
                };

                /**
                 * Converts this ClickResponse to JSON.
                 * @function toJSON
                 * @memberof game.clicker.v1.ClickResponse
                 * @instance
                 * @returns {Object.<string,*>} JSON object
                 */
                ClickResponse.prototype.toJSON = function toJSON() {
                    return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                };

                /**
                 * Gets the default type url for ClickResponse
                 * @function getTypeUrl
                 * @memberof game.clicker.v1.ClickResponse
                 * @static
                 * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                 * @returns {string} The default type url
                 */
                ClickResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                    if (typeUrlPrefix === undefined) {
                        typeUrlPrefix = "type.googleapis.com";
                    }
                    return typeUrlPrefix + "/game.clicker.v1.ClickResponse";
                };

                return ClickResponse;
            })();

            /**
             * Cmd enum.
             * @name game.clicker.v1.Cmd
             * @enum {number}
             * @property {number} CMD_UNSPECIFIED=0 CMD_UNSPECIFIED value
             * @property {number} CMD_CLICK_REQUEST=1000 CMD_CLICK_REQUEST value
             * @property {number} CMD_CLICK_RESPONSE=1001 CMD_CLICK_RESPONSE value
             */
            v1.Cmd = (function() {
                const valuesById = {}, values = Object.create(valuesById);
                values[valuesById[0] = "CMD_UNSPECIFIED"] = 0;
                values[valuesById[1000] = "CMD_CLICK_REQUEST"] = 1000;
                values[valuesById[1001] = "CMD_CLICK_RESPONSE"] = 1001;
                return values;
            })();

            return v1;
        })();

        return clicker;
    })();

    return game;
})();

const $ns_kit = $root.kit = (() => {

    /**
     * Namespace kit.
     * @exports kit
     * @namespace
     */
    const kit = {};

    kit.v1 = (function() {

        /**
         * Namespace v1.
         * @memberof kit
         * @namespace
         */
        const v1 = {};

        /**
         * Cmd enum.
         * @name kit.v1.Cmd
         * @enum {number}
         * @property {number} CMD_UNSPECIFIED=0 CMD_UNSPECIFIED value
         * @property {number} CMD_HANDSHAKE_REQUEST=1 CMD_HANDSHAKE_REQUEST value
         * @property {number} CMD_HANDSHAKE_RESPONSE=2 CMD_HANDSHAKE_RESPONSE value
         * @property {number} CMD_PING=10 CMD_PING value
         * @property {number} CMD_PONG=11 CMD_PONG value
         * @property {number} CMD_KICK=12 CMD_KICK value
         * @property {number} CMD_ERROR=13 CMD_ERROR value
         * @property {number} CMD_AUTH_REQUEST=14 CMD_AUTH_REQUEST value
         * @property {number} CMD_AUTH_RESPONSE=15 CMD_AUTH_RESPONSE value
         * @property {number} CMD_GATEWAY_RETIRING=16 CMD_GATEWAY_RETIRING value
         * @property {number} CMD_LOGIN_REQUEST=20 CMD_LOGIN_REQUEST value
         * @property {number} CMD_LOGIN_RESPONSE=21 CMD_LOGIN_RESPONSE value
         * @property {number} CMD_BIND_REQUEST=22 CMD_BIND_REQUEST value
         * @property {number} CMD_BIND_RESPONSE=23 CMD_BIND_RESPONSE value
         * @property {number} CMD_MAIL_LIST_REQUEST=100 CMD_MAIL_LIST_REQUEST value
         * @property {number} CMD_MAIL_LIST_RESPONSE=101 CMD_MAIL_LIST_RESPONSE value
         * @property {number} CMD_MAIL_CLAIM_REQUEST=102 CMD_MAIL_CLAIM_REQUEST value
         * @property {number} CMD_MAIL_CLAIM_RESPONSE=103 CMD_MAIL_CLAIM_RESPONSE value
         * @property {number} CMD_MAIL_READ_REQUEST=104 CMD_MAIL_READ_REQUEST value
         * @property {number} CMD_MAIL_READ_RESPONSE=105 CMD_MAIL_READ_RESPONSE value
         * @property {number} CMD_MAIL_ARRIVED=110 CMD_MAIL_ARRIVED value
         */
        v1.Cmd = (function() {
            const valuesById = {}, values = Object.create(valuesById);
            values[valuesById[0] = "CMD_UNSPECIFIED"] = 0;
            values[valuesById[1] = "CMD_HANDSHAKE_REQUEST"] = 1;
            values[valuesById[2] = "CMD_HANDSHAKE_RESPONSE"] = 2;
            values[valuesById[10] = "CMD_PING"] = 10;
            values[valuesById[11] = "CMD_PONG"] = 11;
            values[valuesById[12] = "CMD_KICK"] = 12;
            values[valuesById[13] = "CMD_ERROR"] = 13;
            values[valuesById[14] = "CMD_AUTH_REQUEST"] = 14;
            values[valuesById[15] = "CMD_AUTH_RESPONSE"] = 15;
            values[valuesById[16] = "CMD_GATEWAY_RETIRING"] = 16;
            values[valuesById[20] = "CMD_LOGIN_REQUEST"] = 20;
            values[valuesById[21] = "CMD_LOGIN_RESPONSE"] = 21;
            values[valuesById[22] = "CMD_BIND_REQUEST"] = 22;
            values[valuesById[23] = "CMD_BIND_RESPONSE"] = 23;
            values[valuesById[100] = "CMD_MAIL_LIST_REQUEST"] = 100;
            values[valuesById[101] = "CMD_MAIL_LIST_RESPONSE"] = 101;
            values[valuesById[102] = "CMD_MAIL_CLAIM_REQUEST"] = 102;
            values[valuesById[103] = "CMD_MAIL_CLAIM_RESPONSE"] = 103;
            values[valuesById[104] = "CMD_MAIL_READ_REQUEST"] = 104;
            values[valuesById[105] = "CMD_MAIL_READ_RESPONSE"] = 105;
            values[valuesById[110] = "CMD_MAIL_ARRIVED"] = 110;
            return values;
        })();

        /**
         * ErrorCode enum.
         * @name kit.v1.ErrorCode
         * @enum {number}
         * @property {number} ERROR_CODE_UNSPECIFIED=0 ERROR_CODE_UNSPECIFIED value
         * @property {number} ERROR_CODE_OK=1 ERROR_CODE_OK value
         * @property {number} ERROR_CODE_PROTO_VERSION_MISMATCH=1000 ERROR_CODE_PROTO_VERSION_MISMATCH value
         * @property {number} ERROR_CODE_BAD_FRAME=1001 ERROR_CODE_BAD_FRAME value
         * @property {number} ERROR_CODE_UNKNOWN_CMD=1002 ERROR_CODE_UNKNOWN_CMD value
         * @property {number} ERROR_CODE_NOT_HANDSHAKED=1003 ERROR_CODE_NOT_HANDSHAKED value
         * @property {number} ERROR_CODE_UNAUTHENTICATED=2000 ERROR_CODE_UNAUTHENTICATED value
         * @property {number} ERROR_CODE_SESSION_EXPIRED=2001 ERROR_CODE_SESSION_EXPIRED value
         * @property {number} ERROR_CODE_KICKED=2002 ERROR_CODE_KICKED value
         * @property {number} ERROR_CODE_BIND_CONFLICT=2003 ERROR_CODE_BIND_CONFLICT value
         * @property {number} ERROR_CODE_BANNED=2004 ERROR_CODE_BANNED value
         * @property {number} ERROR_CODE_MAINTENANCE=3000 ERROR_CODE_MAINTENANCE value
         * @property {number} ERROR_CODE_RATE_LIMITED=3001 ERROR_CODE_RATE_LIMITED value
         * @property {number} ERROR_CODE_INTERNAL=3002 ERROR_CODE_INTERNAL value
         * @property {number} ERROR_CODE_UPSTREAM_UNAVAILABLE=3003 ERROR_CODE_UPSTREAM_UNAVAILABLE value
         * @property {number} ERROR_CODE_NOT_FOUND=4000 ERROR_CODE_NOT_FOUND value
         * @property {number} ERROR_CODE_ALREADY_DONE=4001 ERROR_CODE_ALREADY_DONE value
         * @property {number} ERROR_CODE_EXPIRED=4002 ERROR_CODE_EXPIRED value
         * @property {number} ERROR_CODE_INVALID_ARGUMENT=4003 ERROR_CODE_INVALID_ARGUMENT value
         */
        v1.ErrorCode = (function() {
            const valuesById = {}, values = Object.create(valuesById);
            values[valuesById[0] = "ERROR_CODE_UNSPECIFIED"] = 0;
            values[valuesById[1] = "ERROR_CODE_OK"] = 1;
            values[valuesById[1000] = "ERROR_CODE_PROTO_VERSION_MISMATCH"] = 1000;
            values[valuesById[1001] = "ERROR_CODE_BAD_FRAME"] = 1001;
            values[valuesById[1002] = "ERROR_CODE_UNKNOWN_CMD"] = 1002;
            values[valuesById[1003] = "ERROR_CODE_NOT_HANDSHAKED"] = 1003;
            values[valuesById[2000] = "ERROR_CODE_UNAUTHENTICATED"] = 2000;
            values[valuesById[2001] = "ERROR_CODE_SESSION_EXPIRED"] = 2001;
            values[valuesById[2002] = "ERROR_CODE_KICKED"] = 2002;
            values[valuesById[2003] = "ERROR_CODE_BIND_CONFLICT"] = 2003;
            values[valuesById[2004] = "ERROR_CODE_BANNED"] = 2004;
            values[valuesById[3000] = "ERROR_CODE_MAINTENANCE"] = 3000;
            values[valuesById[3001] = "ERROR_CODE_RATE_LIMITED"] = 3001;
            values[valuesById[3002] = "ERROR_CODE_INTERNAL"] = 3002;
            values[valuesById[3003] = "ERROR_CODE_UPSTREAM_UNAVAILABLE"] = 3003;
            values[valuesById[4000] = "ERROR_CODE_NOT_FOUND"] = 4000;
            values[valuesById[4001] = "ERROR_CODE_ALREADY_DONE"] = 4001;
            values[valuesById[4002] = "ERROR_CODE_EXPIRED"] = 4002;
            values[valuesById[4003] = "ERROR_CODE_INVALID_ARGUMENT"] = 4003;
            return values;
        })();

        v1.Envelope = (function() {

            /**
             * Properties of an Envelope.
             * @memberof kit.v1
             * @interface IEnvelope
             * @property {kit.v1.ErrorCode|null} [code] Envelope code
             * @property {string|null} [msg] Envelope msg
             * @property {Uint8Array|null} [data] Envelope data
             */

            /**
             * Constructs a new Envelope.
             * @memberof kit.v1
             * @classdesc Represents an Envelope.
             * @implements IEnvelope
             * @constructor
             * @param {kit.v1.IEnvelope=} [properties] Properties to set
             */
            function Envelope(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Envelope code.
             * @member {kit.v1.ErrorCode} code
             * @memberof kit.v1.Envelope
             * @instance
             */
            Envelope.prototype.code = 0;

            /**
             * Envelope msg.
             * @member {string} msg
             * @memberof kit.v1.Envelope
             * @instance
             */
            Envelope.prototype.msg = "";

            /**
             * Envelope data.
             * @member {Uint8Array} data
             * @memberof kit.v1.Envelope
             * @instance
             */
            Envelope.prototype.data = $util.newBuffer([]);

            /**
             * Creates a new Envelope instance using the specified properties.
             * @function create
             * @memberof kit.v1.Envelope
             * @static
             * @param {kit.v1.IEnvelope=} [properties] Properties to set
             * @returns {kit.v1.Envelope} Envelope instance
             */
            Envelope.create = function create(properties) {
                return new Envelope(properties);
            };

            /**
             * Encodes the specified Envelope message. Does not implicitly {@link kit.v1.Envelope.verify|verify} messages.
             * @function encode
             * @memberof kit.v1.Envelope
             * @static
             * @param {kit.v1.IEnvelope} message Envelope message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Envelope.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    writer.uint32(/* id 1, wireType 0 =*/8).int32(message.code);
                if (message.msg != null && Object.hasOwnProperty.call(message, "msg"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.msg);
                if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                    writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.data);
                return writer;
            };

            /**
             * Encodes the specified Envelope message, length delimited. Does not implicitly {@link kit.v1.Envelope.verify|verify} messages.
             * @function encodeDelimited
             * @memberof kit.v1.Envelope
             * @static
             * @param {kit.v1.IEnvelope} message Envelope message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Envelope.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
            };

            /**
             * Decodes an Envelope message from the specified reader or buffer.
             * @function decode
             * @memberof kit.v1.Envelope
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {kit.v1.Envelope} Envelope
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Envelope.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.kit.v1.Envelope();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.code = reader.int32();
                            break;
                        }
                    case 2: {
                            message.msg = reader.string();
                            break;
                        }
                    case 3: {
                            message.data = reader.bytes();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an Envelope message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof kit.v1.Envelope
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {kit.v1.Envelope} Envelope
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Envelope.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an Envelope message.
             * @function verify
             * @memberof kit.v1.Envelope
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Envelope.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    switch (message.code) {
                    default:
                        return "code: enum value expected";
                    case 0:
                    case 1:
                    case 1000:
                    case 1001:
                    case 1002:
                    case 1003:
                    case 2000:
                    case 2001:
                    case 2002:
                    case 2003:
                    case 2004:
                    case 3000:
                    case 3001:
                    case 3002:
                    case 3003:
                    case 4000:
                    case 4001:
                    case 4002:
                    case 4003:
                        break;
                    }
                if (message.msg != null && Object.hasOwnProperty.call(message, "msg"))
                    if (!$util.isString(message.msg))
                        return "msg: string expected";
                if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                    if (!(message.data && typeof message.data.length === "number" || $util.isString(message.data)))
                        return "data: buffer expected";
                return null;
            };

            /**
             * Creates an Envelope message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof kit.v1.Envelope
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {kit.v1.Envelope} Envelope
             */
            Envelope.fromObject = function fromObject(object, long) {
                if (object instanceof $root.kit.v1.Envelope)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".kit.v1.Envelope: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.kit.v1.Envelope();
                switch (object.code) {
                default:
                    if (typeof object.code === "number") {
                        message.code = object.code;
                        break;
                    }
                    break;
                case "ERROR_CODE_UNSPECIFIED":
                case 0:
                    message.code = 0;
                    break;
                case "ERROR_CODE_OK":
                case 1:
                    message.code = 1;
                    break;
                case "ERROR_CODE_PROTO_VERSION_MISMATCH":
                case 1000:
                    message.code = 1000;
                    break;
                case "ERROR_CODE_BAD_FRAME":
                case 1001:
                    message.code = 1001;
                    break;
                case "ERROR_CODE_UNKNOWN_CMD":
                case 1002:
                    message.code = 1002;
                    break;
                case "ERROR_CODE_NOT_HANDSHAKED":
                case 1003:
                    message.code = 1003;
                    break;
                case "ERROR_CODE_UNAUTHENTICATED":
                case 2000:
                    message.code = 2000;
                    break;
                case "ERROR_CODE_SESSION_EXPIRED":
                case 2001:
                    message.code = 2001;
                    break;
                case "ERROR_CODE_KICKED":
                case 2002:
                    message.code = 2002;
                    break;
                case "ERROR_CODE_BIND_CONFLICT":
                case 2003:
                    message.code = 2003;
                    break;
                case "ERROR_CODE_BANNED":
                case 2004:
                    message.code = 2004;
                    break;
                case "ERROR_CODE_MAINTENANCE":
                case 3000:
                    message.code = 3000;
                    break;
                case "ERROR_CODE_RATE_LIMITED":
                case 3001:
                    message.code = 3001;
                    break;
                case "ERROR_CODE_INTERNAL":
                case 3002:
                    message.code = 3002;
                    break;
                case "ERROR_CODE_UPSTREAM_UNAVAILABLE":
                case 3003:
                    message.code = 3003;
                    break;
                case "ERROR_CODE_NOT_FOUND":
                case 4000:
                    message.code = 4000;
                    break;
                case "ERROR_CODE_ALREADY_DONE":
                case 4001:
                    message.code = 4001;
                    break;
                case "ERROR_CODE_EXPIRED":
                case 4002:
                    message.code = 4002;
                    break;
                case "ERROR_CODE_INVALID_ARGUMENT":
                case 4003:
                    message.code = 4003;
                    break;
                }
                if (object.msg != null)
                    message.msg = String(object.msg);
                if (object.data != null)
                    if (typeof object.data === "string")
                        $util.base64.decode(object.data, message.data = $util.newBuffer($util.base64.length(object.data)), 0);
                    else if (object.data.length >= 0)
                        message.data = object.data;
                return message;
            };

            /**
             * Creates a plain object from an Envelope message. Also converts values to other types if specified.
             * @function toObject
             * @memberof kit.v1.Envelope
             * @static
             * @param {kit.v1.Envelope} message Envelope
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Envelope.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.code = options.enums === String ? "ERROR_CODE_UNSPECIFIED" : 0;
                    object.msg = "";
                    if (options.bytes === String)
                        object.data = "";
                    else {
                        object.data = [];
                        if (options.bytes !== Array)
                            object.data = $util.newBuffer(object.data);
                    }
                }
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    object.code = options.enums === String ? $root.kit.v1.ErrorCode[message.code] === undefined ? message.code : $root.kit.v1.ErrorCode[message.code] : message.code;
                if (message.msg != null && Object.hasOwnProperty.call(message, "msg"))
                    object.msg = message.msg;
                if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                    object.data = options.bytes === String ? $util.base64.encode(message.data, 0, message.data.length) : options.bytes === Array ? Array.prototype.slice.call(message.data) : message.data;
                return object;
            };

            /**
             * Converts this Envelope to JSON.
             * @function toJSON
             * @memberof kit.v1.Envelope
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Envelope.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Envelope
             * @function getTypeUrl
             * @memberof kit.v1.Envelope
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Envelope.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/kit.v1.Envelope";
            };

            return Envelope;
        })();

        v1.Item = (function() {

            /**
             * Properties of an Item.
             * @memberof kit.v1
             * @interface IItem
             * @property {string|null} [itemId] Item itemId
             * @property {number|null} [count] Item count
             */

            /**
             * Constructs a new Item.
             * @memberof kit.v1
             * @classdesc Represents an Item.
             * @implements IItem
             * @constructor
             * @param {kit.v1.IItem=} [properties] Properties to set
             */
            function Item(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Item itemId.
             * @member {string} itemId
             * @memberof kit.v1.Item
             * @instance
             */
            Item.prototype.itemId = "";

            /**
             * Item count.
             * @member {number} count
             * @memberof kit.v1.Item
             * @instance
             */
            Item.prototype.count = 0;

            /**
             * Creates a new Item instance using the specified properties.
             * @function create
             * @memberof kit.v1.Item
             * @static
             * @param {kit.v1.IItem=} [properties] Properties to set
             * @returns {kit.v1.Item} Item instance
             */
            Item.create = function create(properties) {
                return new Item(properties);
            };

            /**
             * Encodes the specified Item message. Does not implicitly {@link kit.v1.Item.verify|verify} messages.
             * @function encode
             * @memberof kit.v1.Item
             * @static
             * @param {kit.v1.IItem} message Item message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Item.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.itemId != null && Object.hasOwnProperty.call(message, "itemId"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.itemId);
                if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                    writer.uint32(/* id 2, wireType 1 =*/17).double(message.count);
                return writer;
            };

            /**
             * Encodes the specified Item message, length delimited. Does not implicitly {@link kit.v1.Item.verify|verify} messages.
             * @function encodeDelimited
             * @memberof kit.v1.Item
             * @static
             * @param {kit.v1.IItem} message Item message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Item.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
            };

            /**
             * Decodes an Item message from the specified reader or buffer.
             * @function decode
             * @memberof kit.v1.Item
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {kit.v1.Item} Item
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Item.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.kit.v1.Item();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.itemId = reader.string();
                            break;
                        }
                    case 2: {
                            message.count = reader.double();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an Item message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof kit.v1.Item
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {kit.v1.Item} Item
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Item.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an Item message.
             * @function verify
             * @memberof kit.v1.Item
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Item.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.itemId != null && Object.hasOwnProperty.call(message, "itemId"))
                    if (!$util.isString(message.itemId))
                        return "itemId: string expected";
                if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                    if (typeof message.count !== "number")
                        return "count: number expected";
                return null;
            };

            /**
             * Creates an Item message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof kit.v1.Item
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {kit.v1.Item} Item
             */
            Item.fromObject = function fromObject(object, long) {
                if (object instanceof $root.kit.v1.Item)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".kit.v1.Item: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.kit.v1.Item();
                if (object.itemId != null)
                    message.itemId = String(object.itemId);
                if (object.count != null)
                    message.count = Number(object.count);
                return message;
            };

            /**
             * Creates a plain object from an Item message. Also converts values to other types if specified.
             * @function toObject
             * @memberof kit.v1.Item
             * @static
             * @param {kit.v1.Item} message Item
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Item.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.itemId = "";
                    object.count = 0;
                }
                if (message.itemId != null && Object.hasOwnProperty.call(message, "itemId"))
                    object.itemId = message.itemId;
                if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                    object.count = options.json && !isFinite(message.count) ? String(message.count) : message.count;
                return object;
            };

            /**
             * Converts this Item to JSON.
             * @function toJSON
             * @memberof kit.v1.Item
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Item.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Item
             * @function getTypeUrl
             * @memberof kit.v1.Item
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Item.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/kit.v1.Item";
            };

            return Item;
        })();

        return v1;
    })();

    return kit;
})();

export { $root as default };

// ── 类型（pbts 生成）─────────────────────────────────────────────────
// 运行时的东西全在上面，这一段只是把赋值式命名空间的类型补回来，编译后整块消失。
declare namespace $types {
  /** Namespace game. */
  namespace game {

      /** Namespace clicker. */
      namespace clicker {

          /** Namespace v1. */
          namespace v1 {

              /** Properties of a ClickRequest. */
              interface IClickRequest {

                  /** ClickRequest count */
                  count?: (number|null);
              }

              /** Represents a ClickRequest. */
              class ClickRequest implements IClickRequest {

                  /**
                   * Constructs a new ClickRequest.
                   * @param [properties] Properties to set
                   */
                  constructor(properties?: game.clicker.v1.IClickRequest);

                  /** ClickRequest count. */
                  public count: number;

                  /**
                   * Creates a new ClickRequest instance using the specified properties.
                   * @param [properties] Properties to set
                   * @returns ClickRequest instance
                   */
                  public static create(properties?: game.clicker.v1.IClickRequest): game.clicker.v1.ClickRequest;

                  /**
                   * Encodes the specified ClickRequest message. Does not implicitly {@link game.clicker.v1.ClickRequest.verify|verify} messages.
                   * @param message ClickRequest message or plain object to encode
                   * @param [writer] Writer to encode to
                   * @returns Writer
                   */
                  public static encode(message: game.clicker.v1.IClickRequest, writer?: $protobuf.Writer): $protobuf.Writer;

                  /**
                   * Encodes the specified ClickRequest message, length delimited. Does not implicitly {@link game.clicker.v1.ClickRequest.verify|verify} messages.
                   * @param message ClickRequest message or plain object to encode
                   * @param [writer] Writer to encode to
                   * @returns Writer
                   */
                  public static encodeDelimited(message: game.clicker.v1.IClickRequest, writer?: $protobuf.Writer): $protobuf.Writer;

                  /**
                   * Decodes a ClickRequest message from the specified reader or buffer.
                   * @param reader Reader or buffer to decode from
                   * @param [length] Message length if known beforehand
                   * @returns ClickRequest
                   * @throws {Error} If the payload is not a reader or valid buffer
                   * @throws {$protobuf.util.ProtocolError} If required fields are missing
                   */
                  public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): game.clicker.v1.ClickRequest;

                  /**
                   * Decodes a ClickRequest message from the specified reader or buffer, length delimited.
                   * @param reader Reader or buffer to decode from
                   * @returns ClickRequest
                   * @throws {Error} If the payload is not a reader or valid buffer
                   * @throws {$protobuf.util.ProtocolError} If required fields are missing
                   */
                  public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): game.clicker.v1.ClickRequest;

                  /**
                   * Verifies a ClickRequest message.
                   * @param message Plain object to verify
                   * @returns `null` if valid, otherwise the reason why it is not
                   */
                  public static verify(message: { [k: string]: any }): (string|null);

                  /**
                   * Creates a ClickRequest message from a plain object. Also converts values to their respective internal types.
                   * @param object Plain object
                   * @returns ClickRequest
                   */
                  public static fromObject(object: { [k: string]: any }): game.clicker.v1.ClickRequest;

                  /**
                   * Creates a plain object from a ClickRequest message. Also converts values to other types if specified.
                   * @param message ClickRequest
                   * @param [options] Conversion options
                   * @returns Plain object
                   */
                  public static toObject(message: game.clicker.v1.ClickRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

                  /**
                   * Converts this ClickRequest to JSON.
                   * @returns JSON object
                   */
                  public toJSON(): { [k: string]: any };

                  /**
                   * Gets the default type url for ClickRequest
                   * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                   * @returns The default type url
                   */
                  public static getTypeUrl(typeUrlPrefix?: string): string;
              }

              /** Properties of a ClickResponse. */
              interface IClickResponse {

                  /** ClickResponse code */
                  code?: (kit.v1.ErrorCode|null);

                  /** ClickResponse total */
                  total?: (number|null);
              }

              /** Represents a ClickResponse. */
              class ClickResponse implements IClickResponse {

                  /**
                   * Constructs a new ClickResponse.
                   * @param [properties] Properties to set
                   */
                  constructor(properties?: game.clicker.v1.IClickResponse);

                  /** ClickResponse code. */
                  public code: kit.v1.ErrorCode;

                  /** ClickResponse total. */
                  public total: number;

                  /**
                   * Creates a new ClickResponse instance using the specified properties.
                   * @param [properties] Properties to set
                   * @returns ClickResponse instance
                   */
                  public static create(properties?: game.clicker.v1.IClickResponse): game.clicker.v1.ClickResponse;

                  /**
                   * Encodes the specified ClickResponse message. Does not implicitly {@link game.clicker.v1.ClickResponse.verify|verify} messages.
                   * @param message ClickResponse message or plain object to encode
                   * @param [writer] Writer to encode to
                   * @returns Writer
                   */
                  public static encode(message: game.clicker.v1.IClickResponse, writer?: $protobuf.Writer): $protobuf.Writer;

                  /**
                   * Encodes the specified ClickResponse message, length delimited. Does not implicitly {@link game.clicker.v1.ClickResponse.verify|verify} messages.
                   * @param message ClickResponse message or plain object to encode
                   * @param [writer] Writer to encode to
                   * @returns Writer
                   */
                  public static encodeDelimited(message: game.clicker.v1.IClickResponse, writer?: $protobuf.Writer): $protobuf.Writer;

                  /**
                   * Decodes a ClickResponse message from the specified reader or buffer.
                   * @param reader Reader or buffer to decode from
                   * @param [length] Message length if known beforehand
                   * @returns ClickResponse
                   * @throws {Error} If the payload is not a reader or valid buffer
                   * @throws {$protobuf.util.ProtocolError} If required fields are missing
                   */
                  public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): game.clicker.v1.ClickResponse;

                  /**
                   * Decodes a ClickResponse message from the specified reader or buffer, length delimited.
                   * @param reader Reader or buffer to decode from
                   * @returns ClickResponse
                   * @throws {Error} If the payload is not a reader or valid buffer
                   * @throws {$protobuf.util.ProtocolError} If required fields are missing
                   */
                  public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): game.clicker.v1.ClickResponse;

                  /**
                   * Verifies a ClickResponse message.
                   * @param message Plain object to verify
                   * @returns `null` if valid, otherwise the reason why it is not
                   */
                  public static verify(message: { [k: string]: any }): (string|null);

                  /**
                   * Creates a ClickResponse message from a plain object. Also converts values to their respective internal types.
                   * @param object Plain object
                   * @returns ClickResponse
                   */
                  public static fromObject(object: { [k: string]: any }): game.clicker.v1.ClickResponse;

                  /**
                   * Creates a plain object from a ClickResponse message. Also converts values to other types if specified.
                   * @param message ClickResponse
                   * @param [options] Conversion options
                   * @returns Plain object
                   */
                  public static toObject(message: game.clicker.v1.ClickResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

                  /**
                   * Converts this ClickResponse to JSON.
                   * @returns JSON object
                   */
                  public toJSON(): { [k: string]: any };

                  /**
                   * Gets the default type url for ClickResponse
                   * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                   * @returns The default type url
                   */
                  public static getTypeUrl(typeUrlPrefix?: string): string;
              }

              /** Cmd enum. */
              enum Cmd {
                  CMD_UNSPECIFIED = 0,
                  CMD_CLICK_REQUEST = 1000,
                  CMD_CLICK_RESPONSE = 1001
              }
          }
      }
  }

  /** Namespace kit. */
  namespace kit {

      /** Namespace v1. */
      namespace v1 {

          /** Cmd enum. */
          enum Cmd {
              CMD_UNSPECIFIED = 0,
              CMD_HANDSHAKE_REQUEST = 1,
              CMD_HANDSHAKE_RESPONSE = 2,
              CMD_PING = 10,
              CMD_PONG = 11,
              CMD_KICK = 12,
              CMD_ERROR = 13,
              CMD_AUTH_REQUEST = 14,
              CMD_AUTH_RESPONSE = 15,
              CMD_GATEWAY_RETIRING = 16,
              CMD_LOGIN_REQUEST = 20,
              CMD_LOGIN_RESPONSE = 21,
              CMD_BIND_REQUEST = 22,
              CMD_BIND_RESPONSE = 23,
              CMD_MAIL_LIST_REQUEST = 100,
              CMD_MAIL_LIST_RESPONSE = 101,
              CMD_MAIL_CLAIM_REQUEST = 102,
              CMD_MAIL_CLAIM_RESPONSE = 103,
              CMD_MAIL_READ_REQUEST = 104,
              CMD_MAIL_READ_RESPONSE = 105,
              CMD_MAIL_ARRIVED = 110
          }

          /** ErrorCode enum. */
          enum ErrorCode {
              ERROR_CODE_UNSPECIFIED = 0,
              ERROR_CODE_OK = 1,
              ERROR_CODE_PROTO_VERSION_MISMATCH = 1000,
              ERROR_CODE_BAD_FRAME = 1001,
              ERROR_CODE_UNKNOWN_CMD = 1002,
              ERROR_CODE_NOT_HANDSHAKED = 1003,
              ERROR_CODE_UNAUTHENTICATED = 2000,
              ERROR_CODE_SESSION_EXPIRED = 2001,
              ERROR_CODE_KICKED = 2002,
              ERROR_CODE_BIND_CONFLICT = 2003,
              ERROR_CODE_BANNED = 2004,
              ERROR_CODE_MAINTENANCE = 3000,
              ERROR_CODE_RATE_LIMITED = 3001,
              ERROR_CODE_INTERNAL = 3002,
              ERROR_CODE_UPSTREAM_UNAVAILABLE = 3003,
              ERROR_CODE_NOT_FOUND = 4000,
              ERROR_CODE_ALREADY_DONE = 4001,
              ERROR_CODE_EXPIRED = 4002,
              ERROR_CODE_INVALID_ARGUMENT = 4003
          }

          /** Properties of an Envelope. */
          interface IEnvelope {

              /** Envelope code */
              code?: (kit.v1.ErrorCode|null);

              /** Envelope msg */
              msg?: (string|null);

              /** Envelope data */
              data?: (Uint8Array|null);
          }

          /** Represents an Envelope. */
          class Envelope implements IEnvelope {

              /**
               * Constructs a new Envelope.
               * @param [properties] Properties to set
               */
              constructor(properties?: kit.v1.IEnvelope);

              /** Envelope code. */
              public code: kit.v1.ErrorCode;

              /** Envelope msg. */
              public msg: string;

              /** Envelope data. */
              public data: Uint8Array;

              /**
               * Creates a new Envelope instance using the specified properties.
               * @param [properties] Properties to set
               * @returns Envelope instance
               */
              public static create(properties?: kit.v1.IEnvelope): kit.v1.Envelope;

              /**
               * Encodes the specified Envelope message. Does not implicitly {@link kit.v1.Envelope.verify|verify} messages.
               * @param message Envelope message or plain object to encode
               * @param [writer] Writer to encode to
               * @returns Writer
               */
              public static encode(message: kit.v1.IEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

              /**
               * Encodes the specified Envelope message, length delimited. Does not implicitly {@link kit.v1.Envelope.verify|verify} messages.
               * @param message Envelope message or plain object to encode
               * @param [writer] Writer to encode to
               * @returns Writer
               */
              public static encodeDelimited(message: kit.v1.IEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

              /**
               * Decodes an Envelope message from the specified reader or buffer.
               * @param reader Reader or buffer to decode from
               * @param [length] Message length if known beforehand
               * @returns Envelope
               * @throws {Error} If the payload is not a reader or valid buffer
               * @throws {$protobuf.util.ProtocolError} If required fields are missing
               */
              public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): kit.v1.Envelope;

              /**
               * Decodes an Envelope message from the specified reader or buffer, length delimited.
               * @param reader Reader or buffer to decode from
               * @returns Envelope
               * @throws {Error} If the payload is not a reader or valid buffer
               * @throws {$protobuf.util.ProtocolError} If required fields are missing
               */
              public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): kit.v1.Envelope;

              /**
               * Verifies an Envelope message.
               * @param message Plain object to verify
               * @returns `null` if valid, otherwise the reason why it is not
               */
              public static verify(message: { [k: string]: any }): (string|null);

              /**
               * Creates an Envelope message from a plain object. Also converts values to their respective internal types.
               * @param object Plain object
               * @returns Envelope
               */
              public static fromObject(object: { [k: string]: any }): kit.v1.Envelope;

              /**
               * Creates a plain object from an Envelope message. Also converts values to other types if specified.
               * @param message Envelope
               * @param [options] Conversion options
               * @returns Plain object
               */
              public static toObject(message: kit.v1.Envelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

              /**
               * Converts this Envelope to JSON.
               * @returns JSON object
               */
              public toJSON(): { [k: string]: any };

              /**
               * Gets the default type url for Envelope
               * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
               * @returns The default type url
               */
              public static getTypeUrl(typeUrlPrefix?: string): string;
          }

          /** Properties of an Item. */
          interface IItem {

              /** Item itemId */
              itemId?: (string|null);

              /** Item count */
              count?: (number|null);
          }

          /** Represents an Item. */
          class Item implements IItem {

              /**
               * Constructs a new Item.
               * @param [properties] Properties to set
               */
              constructor(properties?: kit.v1.IItem);

              /** Item itemId. */
              public itemId: string;

              /** Item count. */
              public count: number;

              /**
               * Creates a new Item instance using the specified properties.
               * @param [properties] Properties to set
               * @returns Item instance
               */
              public static create(properties?: kit.v1.IItem): kit.v1.Item;

              /**
               * Encodes the specified Item message. Does not implicitly {@link kit.v1.Item.verify|verify} messages.
               * @param message Item message or plain object to encode
               * @param [writer] Writer to encode to
               * @returns Writer
               */
              public static encode(message: kit.v1.IItem, writer?: $protobuf.Writer): $protobuf.Writer;

              /**
               * Encodes the specified Item message, length delimited. Does not implicitly {@link kit.v1.Item.verify|verify} messages.
               * @param message Item message or plain object to encode
               * @param [writer] Writer to encode to
               * @returns Writer
               */
              public static encodeDelimited(message: kit.v1.IItem, writer?: $protobuf.Writer): $protobuf.Writer;

              /**
               * Decodes an Item message from the specified reader or buffer.
               * @param reader Reader or buffer to decode from
               * @param [length] Message length if known beforehand
               * @returns Item
               * @throws {Error} If the payload is not a reader or valid buffer
               * @throws {$protobuf.util.ProtocolError} If required fields are missing
               */
              public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): kit.v1.Item;

              /**
               * Decodes an Item message from the specified reader or buffer, length delimited.
               * @param reader Reader or buffer to decode from
               * @returns Item
               * @throws {Error} If the payload is not a reader or valid buffer
               * @throws {$protobuf.util.ProtocolError} If required fields are missing
               */
              public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): kit.v1.Item;

              /**
               * Verifies an Item message.
               * @param message Plain object to verify
               * @returns `null` if valid, otherwise the reason why it is not
               */
              public static verify(message: { [k: string]: any }): (string|null);

              /**
               * Creates an Item message from a plain object. Also converts values to their respective internal types.
               * @param object Plain object
               * @returns Item
               */
              public static fromObject(object: { [k: string]: any }): kit.v1.Item;

              /**
               * Creates a plain object from an Item message. Also converts values to other types if specified.
               * @param message Item
               * @param [options] Conversion options
               * @returns Plain object
               */
              public static toObject(message: kit.v1.Item, options?: $protobuf.IConversionOptions): { [k: string]: any };

              /**
               * Converts this Item to JSON.
               * @returns JSON object
               */
              public toJSON(): { [k: string]: any };

              /**
               * Gets the default type url for Item
               * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
               * @returns The default type url
               */
              public static getTypeUrl(typeUrlPrefix?: string): string;
          }
      }
  }
}
export const game: typeof $types.game = $ns_game;
export const kit: typeof $types.kit = $ns_kit;

// 本模块段的 cmd 表。号段由 kit-proto 统一分配，见 README 的分段表。
export const CMD = Object.freeze({
  "ClickRequest": 1000,
  "ClickResponse": 1001
});
