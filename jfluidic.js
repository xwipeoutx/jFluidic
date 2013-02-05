var jFluidic = {};
jFluidic.Program = Class.extend({
    construct: function (gl, glProgramFactory, sharedParameterBinder, sourceCode) {
        this._gl = gl;
        this._glProgramFactory = glProgramFactory;
        this._sharedParameterBinder = sharedParameterBinder;
        this._source = sourceCode;
    },

    loadAssets: function (params) {
        this._buildAndCompileShader();
        this._program = this._glProgramFactory.create(this._fragmentShader);
        this._setupParameters(params);
    },

    go: function (bindings) {
        this._gl.clear(this._gl.DEPTH_BUFFER_BIT | this._gl.COLOR_BUFFER_BIT);

        this._gl.useProgram(this._program);
        this._bindUniformParameters(bindings);
        this._sharedParameterBinder.drawQuad(this._program);
    },
    _setupParameters: function (params) {
        for (var key in params)
            params[key].location = this._gl.getUniformLocation(this._program, key);
        this._params = params;

    },

    _buildAndCompileShader: function () {
        this._fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER);
        this._gl.shaderSource(this._fragmentShader, this._source);
        this._gl.compileShader(this._fragmentShader);

        this._throwIfCompileFailed();
    },

    _throwIfCompileFailed: function () {
        if (!this._gl.getShaderParameter(this._fragmentShader, this._gl.COMPILE_STATUS))
            throw this._getCompileErrorText();
    },

    _getCompileErrorText: function () {
        var lines = this._source.split("\n");
        for (var i = 0; i < lines.length; i++)
            lines[i] = i + ": " + lines[i];
        return "FAILED TO COMPILE SHADER: \n" + this._gl.getShaderInfoLog(this._fragmentShader) + lines.join("\n");
    },

    _bindUniformParameters: function (bindings) {
        this._textureNumber = 0;
        for (var key in bindings)
            this._bindUniformParameter(key, bindings[key]);
    },

    _bindUniformParameter: function (key, value) {
        var param = this._params[key];
        if (!param) {
            console.log("Warning: Param not found in program: ", key);
            return;
        }
        this._setGlUniformParameter(param, value);
    },

    _setGlUniformParameter: function (param, value) {
        // FIXME: Make params classes / typed, if it matters (Which it probably doesn't)
        switch (param.type) {
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
});

jFluidic.SolveStepFactory = Class.extend({
    construct: function (gl, renderer, programLoader) {
        this._gl = gl;
        this._renderer = renderer;
        this._programLoader = programLoader
    },

    create: function (programName, args) {
        var program = this._programLoader.load(programName, args);
        return new jFluidic.SolveStep(this._gl, this._renderer, program);
    }
});

jFluidic.SolveStep = Class.extend({
    construct: function (gl, renderer, program) {
        this._gl = gl;
        this._renderer = renderer;
        this._program = program;
    },

    go: function (bindings, destination) {
        this._renderer.begin(destination);
        this._program.go(bindings);
        this._renderer.end(destination);
    }
});

jFluidic.LinearSolver = Class.extend({
    construct: function (jacobiSolveStep, textureManager, numIterations) {
        this._jacobiSolveStep = jacobiSolveStep;
        this._textureManager = textureManager;
        this._numIterations = numIterations;
    },

    go: function (x, b, destination, d, alpha, beta) {
        for (var i = 0; i < this._numIterations; i++) {
            this._jacobiSolveStep.go({
                x: x.call(this._textureManager),
                b: b.call(this._textureManager),
                d: d,
                alpha: alpha,
                beta: beta
            }, destination);
        }
    }
});

jFluidic.ToTextureRenderer = Class.extend({
    construct: function (gl, textureManager, size) {
        this._gl = gl;
        this._textureManager = textureManager;

        this._framebuffer = this._createFramebuffer(size);
        // Not sure why I don't need this renderbuffer
        //this._renderbuffer = this._createRenderbuffer(width,  height);
    },

    begin: function (destinationFunction) {
        this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._framebuffer);
        this._gl.framebufferTexture2D(this._gl.FRAMEBUFFER, this._gl.COLOR_ATTACHMENT0, this._gl.TEXTURE_2D, this._textureManager.getBuffer(destinationFunction), 0);
    },

    end: function (destinationFunction) {
        this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
        this._textureManager.swap(destinationFunction);
    },

    _createFramebuffer: function (size) {
        var framebuffer = this._gl.createFramebuffer();
        //framebuffer.width = size.x;
        //framebuffer.height = size.y;
        return framebuffer;
    },

    _createRenderbuffer: function (size) {
        var renderbuffer = this._gl.createRenderbuffer();
        this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, renderbuffer);
        this._gl.renderbufferStorage(this._gl.RENDERBUFFER, this._gl.DEPTH_COMPONENT16, size.x, size.y);
        this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, null);
        return renderbuffer;
    }

});

jFluidic.GlProgramFactory = Class.extend({
    construct: function (gl, vertexShader, sharedParameterBinder) {
        this._gl = gl;
        this._vertexShader = vertexShader;
        this._sharedParameterBinder = sharedParameterBinder;
    },

    create: function (fragmentShader) {
        var program = this._createGlProgram(fragmentShader);
        this._gl.useProgram(program);
        this._initializeParameters(program);

        return program
    },

    _createGlProgram: function (fragmentShader) {
        var program = this._gl.createProgram();
        this._attachAndLinkShaders(program, fragmentShader);

        if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS))
            throw "Failed initialization of shader";

        return program;
    },

    _attachAndLinkShaders: function (program, fragmentShader) {
        // TODO: Put utils shaders in here???
        this._gl.attachShader(program, this._vertexShader);
        this._gl.attachShader(program, fragmentShader);
        this._gl.linkProgram(program);
    },

    _initializeParameters: function (program) {
        this._initializeVaryingParameters(program);
        this._sharedParameterBinder.bindMatrices(program);
    },

    _initializeVaryingParameters: function (program) {
        program.arguments = {
            vertices: this._gl.getAttribLocation(program, "vertices"),
            textureCoords: this._gl.getAttribLocation(program, "textureCoords")
        };
        this._gl.enableVertexAttribArray(program.arguments.vertices);
        this._gl.enableVertexAttribArray(program.arguments.textureCoords);
    }
});

jFluidic.TextureLoader = Class.extend({
    construct: function (gl) {
        this._gl = gl;
    },

    createClamped: function (size) {
        return this._create(size, true);
    },

    createWrapped: function (size) {
        return this._create(size, false);
    },

    createFromImage: function (src, callback) {
        var texture = this._gl.createTexture();
        this._loadImageIntoTexture(texture, src, callback)
        return texture;
    },

    _create: function (size, clamp) {
        this._checkForGlFloatExtension();

        var texture = this._gl.createTexture();
        this._initializeEmptyDataTexture(texture, size, clamp);
        return texture;
    },

    _loadImageIntoTexture: function (texture, src, callback) {
        var self = this;
        texture.image = new Image();
        texture.image.onload = function () {
            self._initializeImageTexture(texture);
            if (callback) callback(texture);
        };
        texture.image.src = src;
    },

    _checkForGlFloatExtension: function () {
        if (!this._gl.getExtension('OES_texture_float')) {
            var text = 'This demo requires the OES_texture_float extension';
            throw text;
        }
    },

    _initializeEmptyDataTexture: function (texture, size, clamp) {
        this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
        this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, size.x, size.y, 0, this._gl.RGBA, this._gl.FLOAT, null);
        this._setupTextureParameters(clamp);
        this._gl.bindTexture(this._gl.TEXTURE_2D, null);
    },

    _initializeImageTexture: function (texture) {
        this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
        this._gl.pixelStorei(this._gl.UNPACK_FLIP_Y_WEBGL, true);
        this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, this._gl.RGBA, this._gl.UNSIGNED_BYTE, texture.image);
        this._setupTextureParameters(true);
        this._gl.bindTexture(this._gl.TEXTURE_2D, null);
    },

    _setupTextureParameters: function (clamp) {
        this._setupMipMaps();
        if (clamp)
            this._applyClamping();
    },

    _setupMipMaps: function () {
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.NEAREST); // Linear?
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.NEAREST);
    },

    _applyClamping: function () {
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, this._gl.CLAMP_TO_EDGE);
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, this._gl.CLAMP_TO_EDGE);
    }
});

jFluidic.TextureManager = Class.extend({
    construct: function (gl, textureLoader, solveSize, drawSize) {
        this._gl = gl;
        this._textureLoader = textureLoader;
        this._solveSize = solveSize;
        this._drawSize = drawSize;

        this._solveBuffer = textureLoader.createClamped(solveSize);
        this._drawBuffer = textureLoader.createClamped(drawSize);

        this._vectorField = this._createTextureAndBindBuffer(solveSize, this.vectorField,  this.solveBuffer);
        this._divergenceField = this._createTextureAndBindBuffer(solveSize, this.divergenceField,  this.solveBuffer);
        this._pressure = this._createTextureAndBindBuffer(solveSize, this.pressure,  this.solveBuffer);

        this._ink = this._createTextureAndBindBuffer(drawSize, this.ink,  this.drawBuffer);
    },

    _createTextureAndBindBuffer: function(size, textureFunction, bufferFunction) {
        var texture = this._textureLoader.createClamped(size);
        textureFunction.buffer = bufferFunction;
        return texture;
    },

    getSolveSize: function() { return this._solveSize; },
    getDrawSize: function() { return this._drawSize; },

    vectorField: function (value) {
        return this._vectorField = (value === $.undefined ? this._vectorField : value);
    },

    divergenceField: function (value) {
        return this._divergenceField = (value === $.undefined ? this._divergenceField : value);
    },

    pressure: function (value) {
        return this._pressure = (value === $.undefined ? this._pressure : value);
    },

    ink: function (value) {
        return this._ink = (value === $.undefined ? this._ink : value);
    },

    solveBuffer: function (value) {
        return this._solveBuffer = (value === $.undefined ? this._solveBuffer : value);
    },

    drawBuffer: function (value) {
        return this._drawBuffer = (value === $.undefined ? this._drawBuffer : value);
    },

    getBuffer: function(destinationFunction) {
        var bufferFunction = destinationFunction.buffer;
        return bufferFunction.call(this);
    },

    swap: function (destinationFunction) {
        var bufferFunction = destinationFunction.buffer;
        var bufferTexture = bufferFunction.call(this);
        bufferFunction.call(this, destinationFunction.call(this));
        destinationFunction.call(this, bufferTexture);
    }
});

jFluidic.ProgramLoader = Class.extend({
    construct: function (gl, glProgramFactory, sharedParameterBinder) {
        this._gl = gl;
        this._glProgramFactory = glProgramFactory;
        this._sharedParameterBinder = sharedParameterBinder;
    },

    load: function (fragmentName, utilShaders) {
        var source = this._getSource(fragmentName, utilShaders);
        var params = this._parseSourceForParams(source);
        return this._createAndLoadProgram(source, params);
    },

    _getSource: function (fragmentName, utilShaders) {
        var source = 'precision mediump float;';
        source += this._getUtilShadersSource(utilShaders);
        source += this._getSourceFromDocument(fragmentName + '-fs');
        return source;
    },

    _getUtilShadersSource: function (utilShaders) {
        if (!utilShaders) utilShaders = [];
        var source = '';
        for (var i = 0; i < utilShaders.length; i++)
            source += this._getSourceFromDocument(utilShaders[i] + '-util');
        return source;
    },

    _getSourceFromDocument: function (domElementId) {
        return document.getElementById(domElementId).innerHTML;
    },

    _uniformParamsExpression: /uniform +([a-zA-Z0-9]+) +([a-zA-Z0-9]+)/gi,
    _parseSourceForParams: function (source) {
        var match, params = {};
        while (match = this._uniformParamsExpression.exec(source))
            params[match[2]] = { type: match[1] };
        return params;
    },

    _createAndLoadProgram: function (source, params) {
        var program = new jFluidic.Program(this._gl, this._glProgramFactory, this._sharedParameterBinder, source);
        program.loadAssets(params);
        return program;
    }
});

jFluidic.SharedParameterBinder = Class.extend({
    construct: function (gl) {
        this._gl = gl;
    },

    setup: function () {
        this._vertices = this._createBuffer([1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0], 3, 4);
        this._textureCoords = this._createBuffer([1, 1, 0, 1, 1, 0, 0, 0], 2, 4);
        this._projectionMatrix = this._createProjectionMatrix();
        this._modelViewMatrix = this._createModelViewMatrix();
    },

    bindMatrices: function (program) {
        var projectionMatrixLocation = this._gl.getUniformLocation(program, 'projectionMatrix');
        var modelViewMatrixLocation = this._gl.getUniformLocation(program, 'modelViewMatrix');
        this._gl.uniformMatrix4fv(projectionMatrixLocation, false, this._projectionMatrix);
        this._gl.uniformMatrix4fv(modelViewMatrixLocation, false, this._modelViewMatrix);
    },

    drawQuad: function (program) {
        this._bindGlBuffer(program.arguments.vertices, this._vertices);
        this._bindGlBuffer(program.arguments.textureCoords, this._textureCoords);
        this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, this._vertices.numItems);
    },

    _bindGlBuffer: function (argument, buffer) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, buffer);
        this._gl.vertexAttribPointer(argument, buffer.itemSize, this._gl.FLOAT, false, 0, 0);
    },

    _createBuffer: function (data, itemSize, numItems) {
        var buffer = this._gl.createBuffer();
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, buffer);
        this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array(data), this._gl.STATIC_DRAW);
        buffer.itemSize = itemSize;
        buffer.numItems = numItems;
        return buffer;
    },

    _createProjectionMatrix: function () {
        var projectionMatrix = mat4.create();
        mat4.ortho(0, 1, 0, 1, 0, 1, projectionMatrix);
        return projectionMatrix;
    },

    _createModelViewMatrix: function () {
        var modelViewMatrix = mat4.create();
        mat4.identity(modelViewMatrix);
        return modelViewMatrix;
    }
});

jFluidic.Interactor = Class.extend({
    construct: function (jCanvas, fluid) {
        this._jCanvas = jCanvas;
        this._fluid = fluid;
        this._buttons = {};
        this._bindMouseEvents();
    },

    _bindMouseEvents: function () {
        this._jCanvas.bind({
            mousedown: $.proxy(this._onMouseDown, this),
            mousemove: $.proxy(this._onMouseMove, this),
            mouseout: $.proxy(this._onMouseOut, this),
            mouseup: $.proxy(this._onMouseUp, this)
        });

        $(document).bind('contextmenu', function (event) {
            return false;
        });
    },

    _onMouseDown: function (event) {
        this._buttons[event.which] = true;
        this._inject(event);
        return false;
    },

    _onMouseMove: function (event) {
        this._inject(event);
        return false;
    },

    _onMouseOut: function (event) {
        this._buttons = {};
    },

    _onMouseUp: function (event) {
        this._buttons[event.which] = false;
        this._inject(event);
    },

    _inject: function (event) {
        var x = event.pageX - event.target.offsetLeft;
        var y = event.pageY - event.target.offsetTop;
        if (this._isAnyButtonPressed())
            this._performInject(x, y);
    },

    _isAnyButtonPressed: function () {
        return this._buttons[1] || this._buttons[2] || this._buttons[3];
    },

    _performInject: function (x, y) {
        var position = this._getNormalizedPositionVector(x, y);
        var colorVector = this._getColorVector();
        this._fluid.inject(position, colorVector);
    },

    _getNormalizedPositionVector: function (x, y) {
        x = x / this._jCanvas.width();
        y = 1 - y / this._jCanvas.height();
        return [x, y];
    },

    _getColorVector: function () {
        var red = this._buttons[1] ? 1 : 0;
        var green = this._buttons[2] ? 1 : 0;
        var blue = this._buttons[3] ? 1 : 0;
        return  [red, green, blue, 1];
    }
});

jFluidic.FluidStepRunnerFactory = Class.extend({
    construct: function (textureManager, solveStepFactory) {
        this._textureManager = textureManager;
        this._solveStepFactory = solveStepFactory;
    },

    create: function (numJacobiIterations) {
        var perturbSolveStep = this._solveStepFactory.create('perturb', []);
        var advectSolveStep = this._solveStepFactory.create('advect', ['bilerp']);
        var jacobiSolveStep = this._solveStepFactory.create('jacobi', ['neighbours'])
        var divergenceSolveStep = this._solveStepFactory.create('divergence', ['neighbours']);
        var subtractPressureGradientSolveStep = this._solveStepFactory.create('subtract-pressure-gradient', ['neighbours']);
        var boundarySolveStep = this._solveStepFactory.create('boundary', []);
        var linearSolver = new jFluidic.LinearSolver(jacobiSolveStep, this._textureManager, numJacobiIterations);

        return new jFluidic.FluidStepRunner(this._textureManager,
            perturbSolveStep, advectSolveStep, linearSolver, divergenceSolveStep, subtractPressureGradientSolveStep, boundarySolveStep);
    }
});

jFluidic.FluidStepRunner = Class.extend({
    construct: function (textureManager, perturb, advect, linearSolver, divergence, subtractPressureGradient, boundary) {
        this._textureManager = textureManager;
        this._perturb = perturb;
        this._advect = advect;
        this._linearSolver = linearSolver;
        this._divergence = divergence;
        this._subtractPressureGradient = subtractPressureGradient;
        this._boundary = boundary;
    },

    step: function (dt) {
        var solveSize = this._textureManager.getSolveSize();
        var drawSize = this._textureManager.getDrawSize();
        var dSolve = [1.0 / solveSize.x, 1.0 / solveSize.y, dt];
        var dDraw = [1.0 / drawSize.x, 1.0 / drawSize.y, dt];

        this._perturbStep(dSolve);
        this._advectInkStep(dDraw);
        this._advectVectorFieldStep(dSolve);
        //this._diffuseVectorFieldStep(dSolve, dt);
        this._divergenceStep(dSolve);
        this._projectionStep(dSolve, dt);
        this._boundaryPressure(dSolve);
        this._subtractPressureGradientStep(dSolve);
        this._boundaryVectorFieldStep(dSolve);
    },

    _perturbStep: function (d) {
        this._perturb.go({
            d: d,
            vectorField: this._textureManager.vectorField(),
            affectedField: this._textureManager.ink()
        }, this._textureManager.vectorField);

    },

    _advectInkStep: function (d) {
        this._advect.go({
            d: d,
            vectorField: this._textureManager.vectorField(),
            affectedField: this._textureManager.ink()
        }, this._textureManager.ink);
    },

    _advectVectorFieldStep: function (d) {
        this._advect.go({
            d: d,
            vectorField: this._textureManager.vectorField(),
            affectedField: this._textureManager.vectorField()
        }, this._textureManager.vectorField);
    },

    _diffuseVectorFieldStep: function (d, dt) {
        var diffusionCoeffecient = 0.00001;
        var alpha = dt * diffusionCoeffecient / d[0] * d[1];
        var beta = 1 + 4 * alpha;
        this._linearSolver.go(this._textureManager.vectorField, this._textureManager.vectorField, this._textureManager.vectorField, d, alpha, beta);
    },

    _divergenceStep: function (d) {
        this._divergence.go({
            vectorField: this._textureManager.vectorField(),
            d: d
        }, this._textureManager.divergenceField);
    },

    _projectionStep: function (d) {
        var alpha = 1;
        var beta = 4;
        this._linearSolver.go(this._textureManager.divergenceField, this._textureManager.pressure, this._textureManager.pressure, d, alpha, beta);
    },

    _boundaryPressure: function (d) {
        this._boundary.go({
            field: this._textureManager.pressure(),
            multiple: 1,
            d: d
        }, this._textureManager.pressure);
    }, _subtractPressureGradientStep: function (d) {
        this._subtractPressureGradient.go({
            vectorField: this._textureManager.vectorField(),
            d: d,
            pressure: this._textureManager.pressure()
        }, this._textureManager.vectorField);
    },

    _boundaryVectorFieldStep: function (d) {
        this._boundary.go({
            field: this._textureManager.vectorField(),
            d: d,
            multiple: -1
        }, this._textureManager.vectorField);
    },

});

jFluidic.ConstantStepSolver = Class.extend({
    construct: function (stepSolver, dt) {
        this._stepSolver = stepSolver;
        this._dt = dt;
        this._leftOver = 0;
    },

    step: function (elapsed) {
        if (elapsed > 5)
            this._revertToVaryingSolver();
        if (this._disabled)
            return this._stepSolver.step(elapsed);

        this._leftOver += elapsed;
        this._performSteps();
    },

    _performSteps: function () {
        while (this._leftOver >= this._dt) {
            this._leftOver -= this._dt;
            this._stepSolver.step(this._dt);
        }
    },

    _revertToVaryingSolver: function () {
        this._stepSolver.step(this._leftOver);
        this._disabled = true;
        this._dt = -1;
        console.log("Error: Constant solver has run away. Switching to real-time solver");
    }
});

jFluidic.FpsCalculator = Class.extend({
    construct: function () {
        this._totalFrameCount = 0;
        this._totalElapsedSeconds = 0;

        this._recentFrameCount = 0;
        this._recentElapsedSecondsAverage = 0;
    },

    notifyFrame: function (numSeconds) {
        this._totalFrameCount++;
        this._totalElapsedSeconds += numSeconds;

        this._updateRecentFrameData(numSeconds);
        return "avg=" + this.getAverageFps() + "; recent=" + this.getRecentFps();
    },

    _updateRecentFrameData: function (numSeconds) {
        if (numSeconds == 0) return;
        if (this._recentFrameCount > 100)
            this._recentFrameCount = 5;

        this._recentElapsedSecondsAverage = (this._recentElapsedSecondsAverage * this._recentFrameCount + numSeconds) / (++this._recentFrameCount);
    },

    getAverageFps: function () {
        return this._totalFrameCount / this._totalElapsedSeconds;
    },

    getRecentFps: function () {
        return 1/this._recentElapsedSecondsAverage;
    },

    getTotalFrameCount: function() {
        return this._totalFrameCount;
    }
});

jFluidic.Fluid = Class.extend({
    construct: function (gl, options) {
        this._gl = gl;
        this._options = this._createOptions(gl, options);

        var sharedParameterBinder = new jFluidic.SharedParameterBinder(this._gl);
        sharedParameterBinder.setup();

        var vertexShader = this._createVertexShader();

        this._textureLoader = new jFluidic.TextureLoader(this._gl);
        var textureManager = this._textureManager = new jFluidic.TextureManager(this._gl, this._textureLoader, options.solveSize, options.drawSize);
        var glProgramFactory = new jFluidic.GlProgramFactory(gl, vertexShader, sharedParameterBinder);
        var solveRenderer = new jFluidic.ToTextureRenderer(gl, this._textureManager, options.solveSize);
        var programLoader = new jFluidic.ProgramLoader(gl, glProgramFactory, sharedParameterBinder);
        var solveStepFactory = new jFluidic.SolveStepFactory(gl, solveRenderer, programLoader);

        this._drawProgram = this._drawProgram = programLoader.load('draw');
        this._drawSolveStep = solveStepFactory.create('draw');

        this._injectSolveStep = solveStepFactory.create('inject');
        var fluidStepRunnerFactory = new jFluidic.FluidStepRunnerFactory(textureManager, solveStepFactory);
        var stepRunner = fluidStepRunnerFactory.create(options.numIterations);
        var debugDrawProgram = programLoader.load('debug-draw');

        this._constantStepSolver = new jFluidic.ConstantStepSolver(stepRunner, options.dt);
        this._fpsCalculator = new jFluidic.FpsCalculator();

        // FIXME: Debugging should not be here
        var debugTexture = function (textureName) {
            if (!$('#debug-' + textureName).is(":checked")) return;

            debugDrawProgram.go({
                vectorField: textureManager[textureName]()
            });

            $('#' + textureName).attr('src', $('canvas')[0].toDataURL());
        }

        var draw = function () {
            debugTexture('ink');
            debugTexture('vectorField');
            debugTexture('pressure');
            debugTexture('divergenceField');
        };

        setTimeout($.proxy(this.start,  this), 100);
    },

    _createOptions: function (gl, options) {
        if (!options) options = {};

        if (!options.numIterations) options.numIterations = 20;
        if (!options.drawRadius) options.drawRadius = 0.04;
        if (!options.solveSize) options.solveSize = {};
        if (!options.solveSize.x)options.solveSize.x = gl.viewportWidth || 256;
        if (!options.solveSize.y) options.solveSize.y = gl.viewportHeight || 256;
        if (!options.drawSize) options.drawSize = {};
        if (!options.drawSize.x)options.drawSize.x = gl.viewportWidth || 256;
        if (!options.drawSize.y) options.drawSize.y = gl.viewportHeight || 256;
        if (!options.dt) options.dt = 0.01;
        if (!options.speedMultiplier) options.speedMultiplier = 1;

        return options;
    },

    _createVertexShader: function () {
        var vertexShader = this._gl.createShader(this._gl.VERTEX_SHADER);
        this._gl.shaderSource(vertexShader, document.getElementById('shader-vs').innerHTML);
        this._gl.compileShader(vertexShader);

        //TODO: Abstract

        if (!this._gl.getShaderParameter(vertexShader, this._gl.COMPILE_STATUS))
            throw "Failed to compile vertex shader: " + this._gl.getShaderInfoLog(vertexShader);

        return vertexShader;
    },

    setSpeedMultiplier: function(value) { this._options.speedMultiplier = value; },
    
    start: function () {
        this._previousTime = Date.now();
        this._intervalId = setInterval($.proxy(this._autoStep, this), 0);
    },

    stop: function () {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = false;
        }
    },

    isGoing: function() {
        return !!this._intervalId;
    },

    _autoStep: function () {
        var newTime = Date.now();
        var dt = (newTime - this._previousTime) / 1000.0;
        this._previousTime = newTime;

        this._fpsCalculator.notifyFrame(dt);
        this._constantStepSolver.step(dt * this._options.speedMultiplier);
        this.draw();
        
        if (this._fpsCalculator.getTotalFrameCount() % 100 == 50)
            document.getElementById('fps').innerHTML = this._fpsCalculator.getRecentFps();
    },

    draw: function () {
        this._drawProgram.go({
            vectorField: this._textureManager.ink()
        });
    },

    inject: function (position, velocity) {
        var injectParams = {
            position: position,
            velocity: velocity,
            radius: this._options.drawRadius,
            vectorField: this._textureManager.ink()
        };

        this._injectSolveStep.go(injectParams, this._textureManager.ink);
        if (!this.isGoing())
            this.draw();
    },

    loadImageAsInk: function (src) {
        this._textureLoader.createFromImage(src, drawTextureToInk.bind(this));

        function drawTextureToInk(texture) {
            var bindings = { vectorField: texture };
            this._drawSolveStep.go(bindings, this._textureManager.ink);
            if (!this.isGoing())
                this.draw();
        }

    }

    
});
