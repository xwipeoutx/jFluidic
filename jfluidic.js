var jFluidic = {
    Program: Class.extend({
        construct: function(gl, glProgramFactory, sharedParameterBinder, sourceCode) {
            this._gl = gl;
            this._glProgramFactory = glProgramFactory;
            this._sharedParameterBinder = sharedParameterBinder;
            this._source = sourceCode;
        },
        
        loadAssets: function(params) {
            this._buildAndCompileShader();
            this._program = this._glProgramFactory.create(this._fragmentShader);
            this._setupParameters(params);
        },
        
        go: function(bindings) {
            this._gl.clear(this._gl.DEPTH_BUFFER_BIT | this._gl.COLOR_BUFFER_BIT);
            
            this._gl.useProgram(this._program);
            this._bindUniformParameters(bindings);
            this._sharedParameterBinder.drawQuad(this._program);
            
        },
        _setupParameters: function(params) {
            for (var key in params)
                params[key].location = this._gl.getUniformLocation(this._program, key);
            this._params = params;
        
        },
        
        _buildAndCompileShader: function() {
            this._fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER);
            this._gl.shaderSource(this._fragmentShader, this._source);
            this._gl.compileShader(this._fragmentShader);
            
            this._throwIfCompileFailed();
        },
        
        _throwIfCompileFailed: function() {
            if (!this._gl.getShaderParameter(this._fragmentShader, this._gl.COMPILE_STATUS))
                throw this._getCompileErrorText();
        },
        
        _getCompileErrorText: function() {
            var lines = this._source.split("\n");
            for (var i=0; i < lines.length; i++)
                lines[i] = i + ": " + lines[i];
            return "FAILED TO COMPILE SHADER: \n" + this._gl.getShaderInfoLog(this._fragmentShader) + lines.join("\n");
        },
        
        _bindUniformParameters: function(bindings) {
            this._textureNumber = 0;
            for (var key in bindings)
                this._bindUniformParameter(key, bindings[key]);
        },
        
        _bindUniformParameter: function(key, value) {
            var param = this._params[key];
            if (!param) {
                console.log("Warning: Param not found in program: ", key);
                return;
            }
            this._setGlUniformParameter(param, value);            
        },
        
        _setGlUniformParameter: function(param, value) {        
            // FIXME: Make params classes / typed, if it matters (Which it probably doesn't)
            switch(param.type) {
                case 'vec4':
                    this._gl.uniform4fv(param.location, value);
                    break;
                case 'vec3':
                    this._gl.uniform3fv(param.location, value);
                    break;
                case 'vec2':
                    this._gl.uniform2fv(param.location, value);
                    break;
                case 'float':
                    this._gl.uniform1f(param.location, value);
                    break;
                case 'sampler2D':
                    this._gl.activeTexture(this._gl['TEXTURE' + this._textureNumber]);
                    this._gl.bindTexture(this._gl.TEXTURE_2D, value);
                    this._gl.uniform1i(param.location, this._textureNumber);
                    
                    this._textureNumber++;
                    break;
                default:
                    debugger;
            }
        }
    }),
    
    SolveProgram: Class.extend({
        construct: function(gl, renderer, program) {
            this._gl = gl;
            this._renderer = renderer;
            this._program = program;
        },
        
        go: function(bindings, destination) {
            this._renderer.begin();
            this._program.go(bindings);
            this._renderer.end(destination);
        }
    }),
        
    Solver: Class.extend({
        construct: function(gl, renderer) {
            this._gl = gl;
            this._renderer = renderer;
        },
        
        go: function(program, bindings, destination) {
            this._renderer.begin();
            program.go(bindings);
            this._renderer.end(destination);
        }
    }),
    
    Renderer: Class.extend({
        construct: function(gl, framebuffer, renderbuffer, textureManager) {
            this._gl = gl;
            this._framebuffer = framebuffer;
            this._renderbuffer = renderbuffer;
            this._textureManager = textureManager;
        },
        
        begin: function() {
            this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._framebuffer);
            this._gl.framebufferTexture2D(this._gl.FRAMEBUFFER, this._gl.COLOR_ATTACHMENT0, this._gl.TEXTURE_2D, this._textureManager.buffer(), 0);
        },
        
        end: function(destination) {
            this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
            this._textureManager.swap(destination);
        }
    }),
        
    GlProgramFactory: Class.extend({
        construct: function(gl, vertexShader, sharedParameterBinder) {
            this._gl = gl;
            this._vertexShader = vertexShader;
            this._sharedParameterBinder = sharedParameterBinder;
        },
        
        create: function(fragmentShader) {
            var program = this._createGlProgram(fragmentShader);
            this._gl.useProgram(program);
            this._initializeParameters(program);
            
            return program
        },
        
        _createGlProgram: function(fragmentShader) {
            var program = this._gl.createProgram();
            this._attachAndLinkShaders(program, fragmentShader);
            
            if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) 
                throw "Failed initialization of shader";
            
            return program;
        },
        
        _attachAndLinkShaders: function(program, fragmentShader) {
            // TODO: Put utils shaders in here???
            this._gl.attachShader(program, this._vertexShader);
            this._gl.attachShader(program, fragmentShader);
            this._gl.linkProgram(program);
        },
        
        _initializeParameters: function(program) {
            this._initializeVaryingParameters(program);
            this._sharedParameterBinder.bindMatrices(program);
        },
        
        _initializeVaryingParameters: function(program) {
            program.arguments = {
                vertices: this._gl.getAttribLocation(program, "vertices"),
                textureCoords: this._gl.getAttribLocation(program, "textureCoords")
            };
            this._gl.enableVertexAttribArray(program.arguments.vertices);
            this._gl.enableVertexAttribArray(program.arguments.textureCoords);
        }
    }),
        
    TextureLoader: Class.extend({
        construct: function(gl) {
            this._gl = gl;
        },
        
        createClamped: function(width, height) {
            return this._create(width, height, true);
        },
        
        createWrapped: function(width, height) {
            return this._create(width, height, false);
        },
                
        createFromImage: function(src, callback) {
            var texture = this._gl.createTexture();
            this._loadImageIntoTexture(texture, src, callback)
            return texture;
        },
    
        _create: function(width, height, clamp) {
            this._checkForGlFloatExtension();
            
            var texture = this._gl.createTexture();
            this._initializeEmptyDataTexture(texture, width, height, clamp);
            return texture;
        },
        
        _loadImageIntoTexture: function(texture, src, callback) {
            var self = this;
            texture.image = new Image();
            texture.image.onload = function() {
                self._initializeImageTexture(texture);
                if (callback) callback(texture);
            };
            texture.image.src = src;
        },
        
        _checkForGlFloatExtension: function() {
            if (!this._gl.getExtension('OES_texture_float')) {
                var text = 'This demo requires the OES_texture_float extension';
                throw text;
            }
        },
        
        _initializeEmptyDataTexture: function(texture, width, height, clamp) {
            this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
            this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, width, height, 0, this._gl.RGBA, this._gl.FLOAT, null);
            this._setupTextureParameters(clamp);
            this._gl.bindTexture(this._gl.TEXTURE_2D, null);
        },
        
        _initializeImageTexture: function(texture) {
            this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
            this._gl.pixelStorei(this._gl.UNPACK_FLIP_Y_WEBGL, true);
            this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, this._gl.RGBA, this._gl.UNSIGNED_BYTE, texture.image);
            this._setupTextureParameters(true);
            this._gl.bindTexture(this._gl.TEXTURE_2D, null);
        },
        
        _setupTextureParameters: function(clamp) {
            this._setupMipMaps();
            if (clamp)
                this._applyClamping();
        },
        
        _setupMipMaps: function() {
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.NEAREST); // Linear?
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.NEAREST);
        },
        
        _applyClamping: function() {
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, this._gl.CLAMP_TO_EDGE);
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, this._gl.CLAMP_TO_EDGE);
        }
    }),
        
    TextureManager: Class.extend({
        construct: function(gl, vectorField, buffer, divergenceField, pressure, ink) {
            this._gl = gl;
            this._vectorField = vectorField;
            this._buffer = buffer;
            this._divergenceField = divergenceField;
            this._pressure = pressure;
            this._ink = ink;
        },
       
        vectorField: function(value) {
            return this._vectorField = (value === $.undefined ? this._vectorField : value);
        },
            
        buffer: function(value) {
            return this._buffer = (value === $.undefined ? this._buffer : value);
        },
        
        divergenceField: function(value) {
            return this._divergenceField = (value === $.undefined ? this._divergenceField : value);
        },
        
        pressure: function(value) {
            return this._pressure = (value === $.undefined ? this._pressure : value);
        },
        
        ink: function(value) {
            return this._ink = (value === $.undefined ? this._ink : value);
        },
        
        swap: function(fn) {
            var tmp = this.buffer();
            this.buffer(fn.call(this));
            fn.call(this, tmp);
        }    
    }),
        
    ProgramLoader: Class.extend({
        construct: function(gl, glProgramFactory, sharedParameterBinder) {
            this._gl = gl;
            this._glProgramFactory = glProgramFactory;
            this._sharedParameterBinder = sharedParameterBinder;
        },
    
        load: function(fragmentName, utilShaders) {
            var source = this._getSource(fragmentName, utilShaders);
            var params = this._parseSourceForParams(source);
            return this._createAndLoadProgram(source, params);
        },
        
        _getSource: function(fragmentName, utilShaders) {
            var source = 'precision mediump float;';
            source += this._getUtilShadersSource(utilShaders);
            source += this._getSourceFromDocument(fragmentName + '-fs');
            return source;
        },
        
        _getUtilShadersSource: function(utilShaders) {
            if (!utilShaders) utilShaders = [];
            var source = '';
            for (var i=0; i < utilShaders.length; i++)
                source += this._getSourceFromDocument(utilShaders[i] + '-util');
            return source;
        },
        
        _getSourceFromDocument: function(domElementId) {
            return document.getElementById(domElementId).innerHTML;
        },
        
        _uniformParamsExpression: /uniform +([a-zA-Z0-9]+) +([a-zA-Z0-9]+)/gi,
        _parseSourceForParams: function(source) {
            var match, params = {};
            while (match = this._uniformParamsExpression.exec(source))
                params[match[2]] = { type: match[1] };
            return params;            
        },
        
        _createAndLoadProgram: function(source, params) {
            var program = new jFluidic.Program(this._gl, this._glProgramFactory, this._sharedParameterBinder, source);
            program.loadAssets(params);
            return program;
        }
    }),

    SharedParameterBinder: Class.extend({
        construct: function(gl) {
            this._gl = gl;
        },
        
        setup: function() {
            this._vertices = this._createBuffer([1,1,0,  0,1,0,  1,0,0,  0,0,0], 3, 4);
            this._textureCoords = this._createBuffer([1,1, 0,1, 1,0, 0,0], 2, 4);
            this._projectionMatrix = this._createProjectionMatrix();
            this._modelViewMatrix = this._createModelViewMatrix();
        },
        
        bindMatrices: function(program) {
            var projectionMatrixLocation = this._gl.getUniformLocation(program, 'projectionMatrix');
            var modelViewMatrixLocation = this._gl.getUniformLocation(program, 'modelViewMatrix');
            this._gl.uniformMatrix4fv(projectionMatrixLocation, false, this._projectionMatrix);
            this._gl.uniformMatrix4fv(modelViewMatrixLocation, false, this._modelViewMatrix);
        },
        
        drawQuad: function(program) {
            this._bindGlBuffer(program.arguments.vertices, this._vertices);
            this._bindGlBuffer(program.arguments.textureCoords, this._textureCoords);
            this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, this._vertices.numItems);
        },
        
        _bindGlBuffer: function(argument, buffer) {
            this._gl.bindBuffer(this._gl.ARRAY_BUFFER, buffer);
            this._gl.vertexAttribPointer(argument, buffer.itemSize, this._gl.FLOAT, false, 0, 0);
        },
        
        _createBuffer: function(data, itemSize, numItems) {
            var buffer = this._gl.createBuffer();
            this._gl.bindBuffer(this._gl.ARRAY_BUFFER, buffer);
            this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array(data), this._gl.STATIC_DRAW);
            buffer.itemSize = itemSize;
            buffer.numItems = numItems;
            return buffer;
        },
        
        _createProjectionMatrix: function() {
            var projectionMatrix = mat4.create();
            mat4.ortho(0,1,0,1,0,1, projectionMatrix);
            return projectionMatrix;
        },
        
        _createModelViewMatrix: function() {
            var modelViewMatrix = mat4.create();
            mat4.identity(modelViewMatrix);
            return modelViewMatrix;
        }
    }),
 
    Interactor: Class.extend({
        construct: function(jCanvas, fluid) {
            this._jCanvas = jCanvas;
            this._fluid = fluid;
            this._buttons = {};
            this._bindMouseEvents();
        },
        
        _bindMouseEvents: function() {
            this._jCanvas.bind({
                mousedown: $.proxy(this._onMouseDown, this),
                mousemove: $.proxy(this._onMouseMove, this),
                mouseout: $.proxy(this._onMouseOut, this),
                mouseup: $.proxy(this._onMouseUp, this)
            });
            
            $(document).bind('contextmenu', function(event) {  return false; });   
        },
        
        _onMouseDown: function(event) {
            this._buttons[event.which] = true;
            this._inject(event);
            return false;
        },
        
        _onMouseMove: function(event) {
            this._inject(event);
            return false;
        },
        
        _onMouseOut: function(event) {
            this._buttons = {};
            this._fluid.stopInject();
        },
        
        _onMouseUp: function(event) {
            this._buttons[event.which] = false;
            this._inject(event);
        },
        
        _inject: function(event) {
            var x = event.pageX - event.target.offsetLeft;
            var y = event.pageY - event.target.offsetTop;
            if (this._isAnyButtonPressed())
                this._performInject(x, y);
            else
                this._fluid.stopInject(); 
        },
        
        _isAnyButtonPressed: function() {
            return this._buttons[1] || this._buttons[3];
        },
        
        _performInject: function(x, y) {
            var position = this._getNormalizedPositionVector(x, y);
            var colorVector = this._getColorVector();
            this._fluid.inject(position, colorVector);
        },
        
        _getNormalizedPositionVector: function(x, y) {
            x = x / this._jCanvas.width();
            y = 1 - y / this._jCanvas.height();
            return [x, y];        
        },
        
        _getColorVector: function() {
            var red = this._buttons[1] ? 1 : 0;
            var blue = this._buttons[3] ? 1 : 0;
            return  [red, 0, blue, 1];
        }
    }),
 
    Fluid: Class.extend({
        _getOptions: function(gl, options) {
            if (!options) options = {};
            
            if (!options.numIterations) options.numIterations = 20;
            if (!options.drawRadius) options.drawRadius = 0.04;
            if (!options.width) options.width = gl.viewportWidth || 256;
            if (!options.height) options.height = gl.viewportHeight || 256;
            if (!options.dt) options.dt = 0.01;
            
            return options;
        },
        
        _createVertexShader: function() {
            var vertexShader = this._gl.createShader(this._gl.VERTEX_SHADER);
            this._gl.shaderSource(vertexShader, document.getElementById('shader-vs').innerHTML);
            this._gl.compileShader(vertexShader);
            
            //TODO: Abstract
            
            if (!this._gl.getShaderParameter(vertexShader, this._gl.COMPILE_STATUS))
                throw "Failed to compile vertex shader: " + this._gl.getShaderInfoLog(vertexShader);
            
            return vertexShader;
        },
        
        _createFramebuffer: function() {
            var framebuffer = this._gl.createFramebuffer();
            framebuffer.width = this._options.width;
            framebuffer.height = this._options.height;
            return framebuffer;
        },
        
        _createRenderbuffer: function() {
            var renderbuffer = this._gl.createRenderbuffer();
            this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, renderbuffer);
            this._gl.renderbufferStorage(this._gl.RENDERBUFFER, this._gl.DEPTH_COMPONENT16, this._options.width, this._options.height);
            this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, null);
            return renderbuffer;
        },
        
        _createTextureManager: function(textureLoader) {
            var vectorField = this._createTexture();
            var buffer = this._createTexture();
            var divergenceField = this._createTexture();
            var pressure = this._createTexture();
            var ink = this._createTexture();
            
            return new jFluidic.TextureManager(this._gl, vectorField, buffer, divergenceField, pressure, ink);
        },
        
        _createTexture: function(textureLoader) {
            return this._textureLoader.createClamped(this._options.width, this._options.height);
        },
    
        construct: function(gl, options) {
            this._gl = gl;
            this._options = this._getOptions(gl, options);
        
            var shaderProgram,
                squareVertexPositionBuffer, squareColorBuffer, squareTextureCoordBuffer,
                pMatrix = mat4.create(),
                mvMatrix = mat4.create(),
                texture,
                rttFramebuffer,
                rttTexture
                ;
            var self = this;
            var F = jFluidic;
            var sharedParameterBinder = new jFluidic.SharedParameterBinder(this._gl);
            sharedParameterBinder.setup();
        
            var vertexShader = this._createVertexShader();
            var framebuffer = this._createFramebuffer();            
            var renderbuffer = this._createRenderbuffer();
              
            this._textureLoader = new jFluidic.TextureLoader(this._gl);
            var textureManager = this._textureManager = this._createTextureManager();
            var glProgramFactory = new F.GlProgramFactory(gl, vertexShader, sharedParameterBinder);
            
            var renderer = new F.Renderer(gl, framebuffer, renderbuffer, this._textureManager);
            var programLoader = new F.ProgramLoader(gl, glProgramFactory, sharedParameterBinder);
            var solver = this._solver = new F.Solver(gl, renderer);
            
            var perturbProgram = programLoader.load('perturb', [], { vectorField: { type: 'texture', shaderVariable: 'vectorField' }});    
            var advectProgram = programLoader.load('advect', ['bilerp']);    
            var injectProgram = programLoader.load('inject');    
            var jacobiProgram = programLoader.load('jacobi', ['neighbours'])    
            var divergenceProgram = programLoader.load('divergence', ['neighbours']);    
            var subtractPressureGradientProgram = programLoader.load('subtract-pressure-gradient', ['neighbours']);    
            var boundaryProgram = programLoader.load('boundary', []);    
            var drawProgram = this._drawProgram = programLoader.load('draw');
            
            var debugDrawProgram = programLoader.load('debug-draw');
            
            gl.clearColor(0,0,0,1);
            gl.enable(gl.DEPTH_TEST);
            gl.viewport(0,0,gl.viewportWidth, gl.viewportHeight);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            
            var debugTexture = function(textureName) {
                if (!$('#debug-' + textureName).is(":checked")) return;
                
                debugDrawProgram.go({
                    vectorField: textureManager[textureName]()
                });        
                $('#' + textureName).attr('src', $('canvas')[0].toDataURL());        
            }
            
            var solveLinearSystem = function(x, b, destination, d, alpha, beta) {
                for (var i=0; i < options.numIterations; i++) {
                    solver.go(jacobiProgram, {
                        x: x.call(textureManager),
                        b: b.call(textureManager),
                        d: d,
                        alpha: alpha, 
                        beta: beta 
                    }, destination);
                }
            };
            
            
            var step = function(dt) {
                var d = [1.0/options.width, 1.0/options.height, dt];
                
                if (self._injectParams) {
                    self._injectParams.vectorField = textureManager.ink();
                    solver.go(injectProgram, self._injectParams, textureManager.ink);
                }
                
                solver.go(perturbProgram, {
                    d: d,
                    vectorField: textureManager.vectorField(),
                    affectedField: textureManager.ink()
                }, textureManager.vectorField);
                
                solver.go(advectProgram, {
                    d: d,
                    vectorField: textureManager.vectorField(),
                    affectedField: textureManager.ink()
                }, textureManager.ink);
                
                solver.go(advectProgram, {
                    d: d,
                    vectorField: textureManager.vectorField(),
                    affectedField: textureManager.vectorField()
                }, textureManager.vectorField);
                
                var diffusionCoeffecient = 0.000001;
                var alpha = dt * diffusionCoeffecient * options.width * options.height;
                var beta = 1 + 4 * alpha;
                //solveLinearSystem(textureManager.vectorField, textureManager.vectorField, textureManager.vectorField, d, alpha, beta); // Diffuse
                                                
                solver.go(divergenceProgram, {
                    vectorField: textureManager.vectorField(),
                    d: d
                }, textureManager.divergenceField);
                
                alpha = 1;
                beta = 4;
                solveLinearSystem(textureManager.divergenceField, textureManager.pressure, textureManager.pressure, d, alpha, beta); // Pressure
                
                solver.go(boundaryProgram, {
                    field: textureManager.pressure(),
                    multiple: 1,
                    d: d
                }, textureManager.pressure);
                
                solver.go(subtractPressureGradientProgram, {
                    vectorField: textureManager.vectorField(),
                    d: d,
                    pressure: textureManager.pressure()
                }, textureManager.vectorField);
                
                solver.go(boundaryProgram, {
                    field: textureManager.vectorField(),
                    d: d,
                    multiple: -1
                }, textureManager.vectorField);
            };
            
            var leftOver = 0;
            var constantStep = function(elapsed) {
                var i=0; 
                leftOver += elapsed;
                while(leftOver >= options.dt) {
                    leftOver -= options.dt;
                    step(options.dt);
                    i++;
                }
                if (i > 250) {
                    step(leftOver);
                    options.dt = -1;
                    throw "Error: Constant solver has run away. Switching to real-time solvee"; 
                }
            };
            
            var draw = function() {
                debugTexture('ink');
                debugTexture('vectorField');
                debugTexture('pressure');
                debugTexture('divergenceField');
                
                drawProgram.go({
                    vectorField: textureManager.ink()
                });            
            };
            
            setTimeout(function() {
                var frameNumber = 0;
                var time = Date.now();
                var frameStart = time;
               
                setInterval(function() {
                    if (!$('#go').is(':checked')) {
                        return;
                    }
                    
                    var newTime = Date.now();
                    var dt = (newTime - time)/1000.0;
                    time = newTime;
                    
                    dt = dt * document.getElementById('speedup').value;
                    
                    frameNumber++;
                    if (time - frameStart > 500) {
                        document.getElementById('fps').innerHTML = 1000*frameNumber/(time - frameStart) + ' dt=' + dt;
                        frameNumber = 0;
                        frameStart = time;
                    }
                    
                    if (options.dt > 0) {
                        constantStep(dt);
                    } else {
                        step(dt);
                    }
                    draw();
                }, 0);
            }, 100);
        },
        
        inject: function(position, velocity) {
            this._injectParams = {
                position: position,
                velocity: velocity,
                radius: this._options.drawRadius,
                
            };
        },
        
        stopInject: function() {
            this._injectParams = null;
        },
        
        loadImageAsInk: function(src) {
            var self = this;
            
            this._textureLoader.createFromImage(src, function(texture) {                
                self._solver.go(self._drawProgram, {
                    vectorField: texture
                }, self._textureManager.ink);
            });
        }
    
        
    })
};
