var jFluidic = {
    Program: Class.extend({
        construct: function(gl, context, sourceCode) {
            this._gl = gl;
            this._context = context;
            this._source = sourceCode;
        },
        
        loadAssets: function(params) {
            this._fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER);
            this._gl.shaderSource(this._fragmentShader, this._source);
            this._gl.compileShader(this._fragmentShader);
            
            if (!this._gl.getShaderParameter(this._fragmentShader, this._gl.COMPILE_STATUS))
                throw "FAILED TO COMPILE SHADER: \n" + this._gl.getShaderInfoLog(this._fragmentShader) + this._source;
                
            this._program = this._context.createProgram(this._fragmentShader);
            
            for (var key in params) {
                params[key].location = this._gl.getUniformLocation(this._program, key);
            }
            this._params = params;
        },
        
        go: function(bindings) {
            this._gl.clear(this._gl.DEPTH_BUFFER_BIT | this._gl.COLOR_BUFFER_BIT);
            
            this._gl.useProgram(this._program);
            this._setupParameters(bindings);
            this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, jFluidic.UsedEverywhere.Vertices.numItems);
            
        },
            
        _setupParameters: function(bindings) {
            this._bindBuffer(this._program.arguments.vertices, jFluidic.UsedEverywhere.Vertices);
            this._bindBuffer(this._program.arguments.textureCoords, jFluidic.UsedEverywhere.TextureCoords);
        
            var textureNumber = 0;
            for (var key in bindings) {
                var value = bindings[key];
              
                var param = this._params[key];
                if (!param) {
                    console.log("Warning: Param not found in program: ", binding);
                    continue;
                }
                
                // FIXME: Make params classes / typed, if it matters (Which it probably doesn't)
                switch(param.type) {
                    case 'vec4':
                        this._gl.uniform4fv(param.location, value);
                        break;
                    case 'vec2':
                        this._gl.uniform2fv(param.location, value);
                        break;
                    case 'float':
                        this._gl.uniform1f(param.location, value);
                        break;
                    case 'sampler2D':
                        this._gl.activeTexture(this._gl['TEXTURE' + textureNumber]);
                        this._gl.bindTexture(this._gl.TEXTURE_2D, value);
                        this._gl.uniform1i(param.location, textureNumber);
                        
                        textureNumber++;
                        break;
                    default:
                        debugger;
                }
            }
        
        },
        
        _bindBuffer: function(argument, buffer) {
            this._gl.bindBuffer(this._gl.ARRAY_BUFFER, buffer);
            this._gl.vertexAttribPointer(argument, buffer.itemSize, this._gl.FLOAT, false, 0, 0);
        
        },
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
        
    SolveContext: Class.extend({
        construct: function(gl, vertexShader) {
            this._gl = gl;
            this._vertexShader = vertexShader;
        },
        
        createProgram: function(fragmentShader) {
            var program = this._gl.createProgram();
            // TODO: Put utils shaders in here, instead of dodgy string concat
            this._gl.attachShader(program, this._vertexShader);
            this._gl.attachShader(program, fragmentShader);
            this._gl.linkProgram(program);
            
            if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) 
                throw "Failed initialization of shader";
                    
            this._gl.useProgram(program);
            program.arguments = {
                vertices: this._gl.getAttribLocation(program, "vertices"),
                textureCoords: this._gl.getAttribLocation(program, "textureCoords")
            };
            this._gl.enableVertexAttribArray(program.arguments.vertices);
            this._gl.enableVertexAttribArray(program.arguments.textureCoords);
            
            var projectionMatrixLocation = this._gl.getUniformLocation(program, 'projectionMatrix');
            var modelViewMatrixLocation = this._gl.getUniformLocation(program, 'modelViewMatrix');
            
            this._gl.uniformMatrix4fv(projectionMatrixLocation, false, jFluidic.UsedEverywhere.ProjectionMatrix);
            this._gl.uniformMatrix4fv(modelViewMatrixLocation, false, jFluidic.UsedEverywhere.ModelViewMatrix);
        
            return program
        }
    }),
        
    TextureLoader: Class.extend({
        construct: function(gl) {
            this._gl = gl;
        },
    
        create: function(size) {
            if (!this._gl.getExtension('OES_texture_float')) {
                var text = 'This demo requires the OES_texture_float extension';
                throw text;
              }
          
            var texture = this._gl.createTexture();
            this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.NEAREST); // Linear?
            this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.NEAREST);
            //this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, this._gl.CLAMP_TO_EDGE);
            //this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, this._gl.CLAMP_TO_EDGE);
            this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, size, size, 0, this._gl.RGBA, this._gl.FLOAT, null);
            this._gl.bindTexture(this._gl.TEXTURE_2D, null);
            return texture;
        },
        
        createFromImage: function(src, callback) {
            var gl = this._gl;
            var texture = gl.createTexture();
            texture.image = new Image();
            texture.image.onload = function() {
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.bindTexture(gl.TEXTURE_2D, null);
                if (callback) callback(texture);
            };
            texture.image.src = src;
            return texture;
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
        construct: function(gl, context) {
            this._gl = gl;
            this._context = context;
        },
    
        _uniformParamsExpression: /uniform +([a-zA-Z0-9]+) +([a-zA-Z0-9]+)/gi,
        load: function(fragmentName, utilScripts) {
            if (!utilScripts) utilScripts = [];
            var programSource = 'precision mediump float;';
            for (var i=0; i < utilScripts.length; i++) {
                programSource += document.getElementById(utilScripts[i] + '-util').innerText;
            }
            programSource += document.getElementById(fragmentName + '-fs').innerText;
            
            var match, params = {};
            while (match = this._uniformParamsExpression.exec(programSource)) {
                params[match[2]] = { type: match[1] };
            }
            
            var program = new jFluidic.Program(this._gl, this._context, programSource);
            program.loadAssets(params);
    
            return program;
        }
    }),

    UsedEverywhere: {
        setup: function(gl) {
            var createBuffer = function(data, itemSize, numItems) {
                var buffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
                buffer.itemSize = itemSize;
                buffer.numItems = numItems;
                return buffer;
            };
            
            this.Vertices = createBuffer([1,1,0,  0,1,0,  1,0,0,  0,0,0], 3, 4);
            this.TextureCoords = createBuffer([1,1, 0,1, 1,0, 0,0], 2, 4);
            
            this.ProjectionMatrix = mat4.create();
            mat4.ortho(0,1,0,1,0,1, this.ProjectionMatrix);
            
            this.ModelViewMatrix = mat4.create();
            mat4.identity(this.ModelViewMatrix);
        }
    },
 
    Interactor: Class.extend({
        construct: function(jCanvas, fluid) {
            this._jCanvas = jCanvas;
            this._fluid = fluid;
            this._buttons = {};
            
            jCanvas.bind({
                mousedown: $.proxy(this._onMouseDown, this),
                mousemove: $.proxy(this._onMouseMove, this),
                mouseout: $.proxy(this._onMouseOut, this),
                mouseup: $.proxy(this._onMouseUp, this)
            });
            
            $(document).bind('contextmenu', function(event) {  return false; });            
        },
        
        _onMouseDown: function(event) {
            this._buttons[event.which] = true;
            this._injectVelocity(event.offsetX, event.offsetY);
            return false;
        },
        
        _onMouseMove: function(event) {
            this._injectVelocity(event.offsetX, event.offsetY);
            return false;
        },
        
        _onMouseOut: function(event) {
            this._buttons = {};
            this._fluid.stopInject();
        },
        
        _onMouseUp: function(event) {
            this._buttons[event.which] = false;
            this._injectVelocity(event.offsetX, event.offsetY);
        },
        
        _injectVelocity: function(x, y) {
            if (!this._buttons[1] && !this._buttons[3]) {
                this._fluid.stopInject();
                return;
            }
            
            x = x / 256.0;
            y = 1 - y / 256.0;
            
            var r = this._buttons[1] ? 1 : 0;
            var b = this._buttons[3] ? 1 : 0;
            
            this._fluid.inject([x, y], [r, 0, b, 1]);
        }
    }),
 
    Fluid: Class.extend({
        construct: function(gl) {
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
            F.UsedEverywhere.setup(gl);
        
            var vertexShader = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vertexShader, document.getElementById('shader-vs').innerText);
            gl.compileShader(vertexShader);
        
            var framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            framebuffer.width = 256;
            framebuffer.height = 256;
            
            var renderbuffer = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 256, 256);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              
            var textureLoader = this._textureLoader = new F.TextureLoader(gl);
            var vectorField = textureLoader.create(256);
            var buffer = textureLoader.create(256);
            var divergenceField = textureLoader.create(256);
            var pressure = textureLoader.create(256);
            var ink = textureLoader.create(256);
            
            var textureManager = this._textureManager = new F.TextureManager(gl, vectorField, buffer, divergenceField, pressure, ink);
            var context = new F.SolveContext(gl, vertexShader);
            
            var renderer = new F.Renderer(gl, framebuffer, renderbuffer, textureManager);
            var programLoader = new F.ProgramLoader(gl, context);
            var solver = this._solver = new F.Solver(gl, renderer);
            
            var perturbProgram = programLoader.load('perturb', [], { vectorField: { type: 'texture', shaderVariable: 'vectorField' }});    
            var advectProgram = programLoader.load('advect', ['bilerp']);    
            var injectProgram = programLoader.load('inject');    
            var jacobiProgram = programLoader.load('jacobi', ['neighbours'])    
            var divergenceProgram = programLoader.load('divergence', ['neighbours']);    
            var subtractPressureGradientProgram = programLoader.load('subtract-pressure-gradient', ['neighbours']);    
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
            
            var solveLinearSystem = function(x, b, destination, alpha, beta) {
                for (var i=0; i < 20; i++) {
                    solver.go(jacobiProgram, {
                        x: x.call(textureManager),
                        b: b.call(textureManager),
                        alpha: alpha, 
                        beta: beta 
                    }, destination);
                }
            };
            
            setTimeout(function() {
                var frameNumber = 0;
                var time = Date.now();
                var frameStart = time;
                var maxSecondsBetweenFrames = 0.01;
                var maxSolvesPerSecond = 2000;
               
                setInterval(function() {                    
                    if (!$('#go').is(':checked')) {
                        return;
                    }
                    
                    var singleStep = $("#single-step").is(":checked");
                    var timeThisFrame = 0;
                    var solvesThisFrame = 0;
                    
                    while(timeThisFrame < maxSecondsBetweenFrames && solvesThisFrame < maxSolvesPerSecond*maxSecondsBetweenFrames && (!singleStep || solvesThisFrame == 0) ) {
                        if (self._injectParams) {
                            solver.go(injectProgram, self._injectParams, textureManager.ink);
                        }
                        
                        var newTime = Date.now();
                        var dt = (newTime - time)/1000.0;
                        time = newTime;
                        timeThisFrame += dt;
                        solvesThisFrame++;
                        
                        dt = dt * document.getElementById('speedup').value;
                        //dt = 0.01;
                        frameNumber++;
                        if (time - frameStart > 500) {
                            document.getElementById('fps').innerHTML = 1000*frameNumber/(time - frameStart) + ' dt=' + dt;
                            frameNumber = 0;
                            frameStart = time;
                        }
                        
                        solver.go(perturbProgram, {
                            dt: dt,
                            vectorField: textureManager.vectorField(),
                            affectedField: textureManager.ink()
                        }, textureManager.vectorField);
                        
                        solver.go(advectProgram, {
                            dt: dt,
                            vectorField: textureManager.vectorField(),
                            affectedField: textureManager.ink()
                        }, textureManager.ink);
                        
                        solver.go(advectProgram, {
                            dt: dt,
                            vectorField: textureManager.vectorField(),
                            affectedField: textureManager.vectorField()
                        }, textureManager.vectorField);
                        
                        var diffusionCoeffecient = 0.000001;
                        var alpha = dt * diffusionCoeffecient * 256 * 256;
                        var beta = 1 + 4 * alpha;
                        //solveLinearSystem(textureManager.vectorField, textureManager.vectorField, textureManager.vectorField, alpha, beta); // Diffuse
                                        
                        solver.go(divergenceProgram, {
                            vectorField: textureManager.vectorField()
                        }, textureManager.divergenceField);
                        
                        alpha = 1;
                        beta = 4;
                        solveLinearSystem(textureManager.divergenceField, textureManager.pressure, textureManager.pressure, alpha, beta); // Pressure
                        
                        solver.go(subtractPressureGradientProgram, {
                            vectorField: textureManager.vectorField(),
                            pressure: textureManager.pressure()
                        }, textureManager.vectorField);
                    }
                    debugTexture('ink');
                    debugTexture('vectorField');
                    debugTexture('pressure');
                    debugTexture('divergenceField');
                    
                    drawProgram.go({
                        vectorField: textureManager.ink()
                    });
                }, 0);
            }, 100);
        },
        
        inject: function(position, velocity) {
            this._injectParams = {
                position: position,
                velocity: velocity
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