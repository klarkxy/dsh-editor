function __createDshNodeShims() {
  class EventEmitter {
    constructor() {
      this._e = Object.create(null)
    }
    on(type, fn) {
      (this._e[type] ||= []).push(fn)
      return this
    }
    addListener(type, fn) {
      return this.on(type, fn)
    }
    once(type, fn) {
      const wrap = (...args) => {
        this.off(type, wrap)
        fn(...args)
      }
      return this.on(type, wrap)
    }
    off(type, fn) {
      const list = this._e[type]
      if (list) this._e[type] = list.filter((item) => item !== fn)
      return this
    }
    removeListener(type, fn) {
      return this.off(type, fn)
    }
    emit(type, ...args) {
      const list = this._e[type]
      if (!list) return false
      for (const fn of list.slice()) fn(...args)
      return true
    }
    removeAllListeners(type) {
      if (type) delete this._e[type]
      else this._e = Object.create(null)
      return this
    }
    listeners(type) {
      return (this._e[type] || []).slice()
    }
    setMaxListeners() {
      return this
    }
  }

  class Buffer extends Uint8Array {
    static from(value, encodingOrOffset, length) {
      if (typeof value === 'string') return new Buffer(new TextEncoder().encode(value))
      if (value instanceof ArrayBuffer) return new Buffer(new Uint8Array(value, encodingOrOffset, length))
      if (ArrayBuffer.isView(value)) return new Buffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      if (Array.isArray(value) || value && typeof value.length === 'number') return new Buffer(Uint8Array.from(value))
      return new Buffer(0)
    }
    static alloc(size, fill) {
      const buf = new Buffer(size)
      if (fill !== undefined && fill !== 0) {
        if (typeof fill === 'string') {
          const bytes = new TextEncoder().encode(fill)
          for (let i = 0; i < size; i += 1) buf[i] = bytes[i % bytes.length]
        } else buf.fill(fill)
      }
      return buf
    }
    static allocUnsafe(size) {
      return new Buffer(size)
    }
    static allocUnsafeSlow(size) {
      return new Buffer(size)
    }
    static concat(list, totalLength) {
      const length = totalLength ?? list.reduce((sum, item) => sum + item.length, 0)
      const out = new Buffer(length)
      let offset = 0
      for (const item of list) {
        out.set(item, offset)
        offset += item.length
      }
      return out
    }
    static isBuffer(value) {
      return value instanceof Buffer
    }
    static byteLength(value) {
      if (typeof value === 'string') return new TextEncoder().encode(value).length
      return value?.byteLength ?? value?.length ?? 0
    }
    static isEncoding(encoding) {
      return /^(utf8|utf-8|ascii|latin1|binary|hex|base64|base64url)$/i.test(String(encoding || ''))
    }
    toString(encoding) {
      if (encoding === 'hex') return [...this].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      if (encoding === 'base64') {
        let binary = ''
        this.forEach((byte) => {
          binary += String.fromCharCode(byte)
        })
        return btoa(binary)
      }
      return new TextDecoder().decode(this)
    }
    slice(start, end) {
      return Buffer.from(super.subarray(start, end))
    }
    copy(target, targetStart = 0, start = 0, end = this.length) {
      const sliced = this.subarray(start, end)
      target.set(sliced, targetStart)
      return sliced.length
    }
    write(string, offset = 0) {
      const bytes = new TextEncoder().encode(string)
      const written = Math.min(bytes.length, this.length - offset)
      this.set(bytes.subarray(0, written), offset)
      return written
    }
  }

  function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, writable: true, configurable: true },
    })
  }

  if (!globalThis.Buffer) globalThis.Buffer = Buffer

  return {
    buffer: { Buffer, SlowBuffer: Buffer, INSPECT_MAX_BYTES: 50, kMaxLength: 0x7fffffff },
    stream: {
      Stream: EventEmitter,
      Readable: EventEmitter,
      Writable: EventEmitter,
      Duplex: EventEmitter,
      Transform: EventEmitter,
      PassThrough: EventEmitter,
    },
    events: { EventEmitter },
    util: {
      deprecate(fn) {
        return fn
      },
      inherits,
      inspect() {
        return ''
      },
      format(value) {
        return String(value)
      },
      types: { isBuffer: Buffer.isBuffer },
    },
  }
}
