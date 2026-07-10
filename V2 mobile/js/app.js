const canvas = document.getElementById('output_canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 10);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

// Lantai dibuat besar dan seperti Grid agar terlihat perspektif jauh/dekat (3D)
let floorY = -3;
const gridHelper = new THREE.GridHelper(100, 50, 0x00ff00, 0x4a4a4a);
gridHelper.position.y = floorY;
scene.add(gridHelper);

const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshBasicMaterial({ visible: false });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = floorY;
scene.add(floor);

// Fisika 3D Penuh (Z tidak lagi dikunci)
const world = new CANNON.World();
world.gravity.set(0, -38, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

const groundMaterial = new CANNON.Material("groundMaterial");
const blockMaterial = new CANNON.Material("blockMaterial");

world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial, blockMaterial, { friction: 0.9, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(blockMaterial, blockMaterial, { friction: 1.0, restitution: 0.0 }));

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMaterial });
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
groundBody.position.set(0, floorY, 0);
world.addBody(groundBody);

let blocks = [];
let deleteMode = false;
let grabbedBlock = null;

const gltfLoader = new THREE.GLTFLoader();

function setBlockColor(block, colorHex) {
    if (!block || !block.mesh) return;
    block.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.color.setHex(colorHex);
        }
    });
}

function setBlockEmissive(block, colorHex, intensity) {
    if (!block || !block.mesh) return;
    block.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
            child.material.emissive.setHex(colorHex);
            child.material.emissiveIntensity = intensity;
        }
    });
}

function disposeBlockMesh(block) {
    if (!block || !block.mesh) return;
    block.mesh.traverse((child) => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        }
    });
}

function updatePhysicsShape(block, scale) {
    block.body.shapes.length = 0;
    block.body.shapeOffsets.length = 0;
    block.body.shapeOrientations.length = 0;

    let physicsShape;
    switch (block.shape) {
        case 'cube': physicsShape = new CANNON.Box(new CANNON.Vec3(scale, scale, scale)); break;
        case 'bridge':
        case 'pyramid': physicsShape = new CANNON.Box(new CANNON.Vec3(1.6 * scale, 1.2 * scale, 1.6 * scale)); break;
        case 'cylinder': physicsShape = new CANNON.Sphere(1.6 * scale); break;
        case 'rect': physicsShape = new CANNON.Box(new CANNON.Vec3(1.6 * scale, 1.2 * scale, 1.6 * scale)); break;
        default: physicsShape = new CANNON.Box(new CANNON.Vec3(scale, scale, scale));
    }
    block.body.addShape(physicsShape);
    block.body.updateMassProperties();
    block.body.updateBoundingRadius();
}

function spawnBlock(shape, colorHex, x = 0, y = 1, z = 0) {
    const mesh = new THREE.Group();
    mesh.position.set(x, y, z);
    scene.add(mesh);

    let assetUrl = '';
    let physicsShape;
    
    switch (shape) {
        case 'cube': 
            assetUrl = 'aset/Persegi.glb';
            physicsShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1)); 
            break;
        case 'rect':
            assetUrl = 'aset/persegiPanjang.glb';
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.6, 1.2, 1.6));
            break;
        case 'pyramid': 
            assetUrl = 'aset/LimasSegiEmpat.glb';
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.6, 1.2, 1.6)); 
            break;
        case 'cylinder': 
            assetUrl = 'aset/tabung.glb';
            physicsShape = new CANNON.Sphere(1.6); 
            break;
        case 'bridge':
            assetUrl = 'aset/balokjembatan.glb';
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.6, 1.2, 1.6));
            break;
        default: 
            assetUrl = 'aset/Persegi.glb';
            physicsShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
    }

    gltfLoader.load(assetUrl, (gltf) => {
        const model = gltf.scene;
        
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0.001) {
            const scale = 2 / maxDim;
            model.scale.set(scale, scale, scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        }

        model.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                if (colorHex) child.material.color.setHex(colorHex);
            }
        });
        mesh.add(model);
    });

    const body = new CANNON.Body({ mass: 1, material: blockMaterial });
    body.addShape(physicsShape);
    body.position.set(x, y, z);
    world.addBody(body);

    const blockObj = {
        mesh,
        shape,
        body,
        baseColor: colorHex || 0x00ff00,
        velocityY: 0,
        isGrabbed: false,
        isSelected: false
    };
    
    blocks.push(blockObj);
    return blockObj;
}

// Tombol Virtual HUD
const btnGeo = new THREE.BoxGeometry(0.8, 0.2, 0.05);
const btnMat = new THREE.MeshPhongMaterial({ color: 0xff9d00 });
const virtualBtn = new THREE.Mesh(btnGeo, btnMat);
virtualBtn.position.set(2, 1.5, -5); 
camera.add(virtualBtn); 

let isScaling = false;
let initialHandsDistance = 0;
let initialBalokScale = 1;
let prevPinch = false;
let selectionCooldown = 0;

let showTracking = false;
let cameraActive = false;
let btnCooldown = 0;
let currentFacingMode = 'environment';
let _animFrameId = null;

const trackingCanvas = document.getElementById('tracking_canvas');
const trackingCtx = trackingCanvas.getContext('2d');
trackingCanvas.width = window.innerWidth;
trackingCanvas.height = window.innerHeight;

const videoElement = document.getElementById('webcam');
const btnTracking = document.getElementById('btn-tracking');
const statusEl = document.getElementById('status');
const cameraBtn = document.getElementById('camera-btn');

let orientationActive = false;
let deviceAlpha = 0, deviceBeta = 90, deviceGamma = 0;

const _zee = new THREE.Vector3(0, 0, 1);
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _deviceQuaternion = new THREE.Quaternion();
const _deviceEuler = new THREE.Euler();
let _calibrationQuaternion = null;
const _calibrationInverse = new THREE.Quaternion();

const _raycaster = new THREE.Raycaster();
const _screenCoord = new THREE.Vector2();

let dragPlane = new THREE.Plane();
let grabOffset = new THREE.Vector3();
let _intersectPoint = new THREE.Vector3();

function onDeviceOrientation(event) {
    if (event.alpha === null) return;
    deviceAlpha = event.alpha;
    deviceBeta = event.beta;
    deviceGamma = event.gamma;
}

function startOrientation() {
    _calibrationQuaternion = null;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(response => {
            if (response === 'granted') {
                window.addEventListener('deviceorientation', onDeviceOrientation, true);
                orientationActive = true;
            }
        }).catch(console.error);
    } else {
        window.addEventListener('deviceorientation', onDeviceOrientation, true);
        orientationActive = true;
    }
}

function stopOrientation() {
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);
    orientationActive = false;
    _calibrationQuaternion = null;
    camera.quaternion.set(0, 0, 0, 1);
    camera.position.set(0, 1, 10);
}

function _computeDeviceQuaternion() {
    const alpha = THREE.MathUtils.degToRad(deviceAlpha);
    const beta = THREE.MathUtils.degToRad(deviceBeta);
    const gamma = THREE.MathUtils.degToRad(deviceGamma);
    const orient = THREE.MathUtils.degToRad(window.orientation || 0);

    _deviceEuler.set(beta, alpha, -gamma, 'YXZ');
    _deviceQuaternion.setFromEuler(_deviceEuler);
    _deviceQuaternion.multiply(_q1);
    _deviceQuaternion.multiply(_q0.setFromAxisAngle(_zee, -orient));

    return _deviceQuaternion;
}

function applyDeviceOrientation() {
    if (!orientationActive) return;
    const currentQuat = _computeDeviceQuaternion();
    if (!_calibrationQuaternion) {
        _calibrationQuaternion = currentQuat.clone();
        _calibrationInverse.copy(_calibrationQuaternion).invert();
    }
    const relativeQuat = _calibrationInverse.clone().multiply(currentQuat);
    camera.quaternion.copy(relativeQuat);
}

function getDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function updateStatus(message, isError = false) {
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.background = isError ? 'rgba(120, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.6)';
    }
}

async function startCamera() {
    updateStatus('Meminta akses kamera...');
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        });

        videoElement.srcObject = stream;
        await videoElement.play();

        cameraActive = true;
        showTracking = true;
        virtualBtn.material.color.setHex(0x00ff00);
        if (cameraBtn) cameraBtn.classList.add('active');

        const mirrorValue = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        videoElement.style.transform = mirrorValue;
        trackingCanvas.style.transform = mirrorValue;

        if (currentFacingMode === 'environment') {
            startOrientation();
        }

        updateStatus(currentFacingMode === 'environment' ? 'Kamera belakang aktif.' : 'Kamera depan aktif.');

        function processFrame() {
            if (!cameraActive) return;
            if (videoElement.readyState >= 2) {
                hands.send({ image: videoElement }).then(() => {
                    _animFrameId = requestAnimationFrame(processFrame);
                });
            } else {
                _animFrameId = requestAnimationFrame(processFrame);
            }
        }
        processFrame();

    } catch (error) {
        updateStatus('Gagal menyalakan kamera. Izinkan kamera di browser.', true);
        cameraActive = false;
        if (cameraBtn) cameraBtn.classList.remove('active');
    }
}

function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    setTimeout(startCamera, 300);
}

function stopCamera() {
    cameraActive = false;
    if (_animFrameId) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = null;
    }
    
    if (orientationActive) stopOrientation();
    
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
    
    showTracking = false;
    virtualBtn.material.color.setHex(0xff9d00);
    updateStatus('Kamera dinonaktifkan.');
    
    if (cameraBtn) cameraBtn.classList.remove('active');
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
}

function toggleCamera() {
    if (cameraActive) stopCamera();
    else startCamera();
}

if (btnTracking) {
    btnTracking.addEventListener('click', () => {
        startCamera();
        btnTracking.style.display = 'none';
        showTracking = true;
        virtualBtn.material.color.setHex(0x00ff00);
    });
}

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

function getScreenCoordsFromMediaPipe(normX, normY) {
    const videoW = videoElement.videoWidth;
    const videoH = videoElement.videoHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (!videoW || !videoH) return { x: normX * 2 - 1, y: -(normY * 2 - 1) };
    const videoAR = videoW / videoH;
    const windowAR = winW / winH;
    let renderW, renderH, offsetX, offsetY;
    if (windowAR > videoAR) {
        const scale = winW / videoW;
        renderW = winW;
        renderH = videoH * scale;
        offsetX = 0;
        offsetY = (renderH - winH) / 2;
    } else {
        const scale = winH / videoH;
        renderW = videoW * scale;
        renderH = winH;
        offsetX = (renderW - winW) / 2;
        offsetY = 0;
    }
    const screenPxX = (normX * renderW) - offsetX;
    const screenPxY = (normY * renderH) - offsetY;
    return { x: (screenPxX / winW) * 2 - 1, y: -(screenPxY / winH) * 2 + 1 };
}

hands.onResults((results) => {
    if (videoElement.videoWidth && videoElement.videoHeight) {
        if (trackingCanvas.width !== videoElement.videoWidth || trackingCanvas.height !== videoElement.videoHeight) {
            trackingCanvas.width = videoElement.videoWidth;
            trackingCanvas.height = videoElement.videoHeight;
        }
    }
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
    
    if (showTracking && results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(trackingCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
            drawLandmarks(trackingCtx, landmarks, { color: '#FF0000', lineWidth: 1 });
        }
    }

    if (btnCooldown > 0) btnCooldown--;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand1 = results.multiHandLandmarks[0];
        const hand2 = results.multiHandLandmarks.length > 1 ? results.multiHandLandmarks[1] : null;

        const isHand1Pinching = getDistance(hand1[4], hand1[8]) < 0.12;
        const isHand2Pinching = hand2 ? getDistance(hand2[4], hand2[8]) < 0.12 : false;
        const isAnyPinching = isHand1Pinching || isHand2Pinching;

        const midX1 = (hand1[4].x + hand1[8].x) / 2;
        const midY1 = (hand1[4].y + hand1[8].y) / 2;
        
        const finalX = currentFacingMode === 'user' ? (1 - midX1) : midX1;
        const coords = getScreenCoordsFromMediaPipe(finalX, midY1);
        _screenCoord.set(coords.x, coords.y);
        _raycaster.setFromCamera(_screenCoord, camera);

        let clickedHTMLButton = false;
        if (isHand1Pinching && btnCooldown === 0) {
            const screenX = finalX * window.innerWidth;
            const screenY = midY1 * window.innerHeight;
            const element = document.elementFromPoint(screenX, screenY);
            
            if (element) {
                const button = element.closest('button');
                if (button) {
                    button.click();
                    btnCooldown = 30;
                    clickedHTMLButton = true;
                }
            }
        }

        if (!clickedHTMLButton) {
            const btnIntersects = _raycaster.intersectObject(virtualBtn);
            if (isHand1Pinching && btnIntersects.length > 0 && btnCooldown === 0) {
                showTracking = !showTracking;
                virtualBtn.material.color.setHex(showTracking ? 0x00ff00 : 0xff9d00);
                btnCooldown = 30;
            }

            let isScalingNow = false;
            if (hand2 && isHand1Pinching && isHand2Pinching && grabbedBlock) {
                isScalingNow = true;
                const currentDistance = getDistance(hand1[8], hand2[8]);

                if (!isScaling) {
                    isScaling = true;
                    initialHandsDistance = currentDistance;
                    initialBalokScale = grabbedBlock.mesh.scale.x;
                } else {
                    let newScale = initialBalokScale * (currentDistance / initialHandsDistance);
                    newScale = Math.max(0.5, Math.min(newScale, 5));
                    grabbedBlock.mesh.scale.set(newScale, newScale, newScale);
                    setBlockColor(grabbedBlock, 0xffff00);
                    updatePhysicsShape(grabbedBlock, newScale);
                }
            }

            if (!isScalingNow) isScaling = false;

            let closestBlock = null;
            const blockMeshes = blocks.map(b => b.mesh);
            const intersects = _raycaster.intersectObjects(blockMeshes, true);
            
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;
                closestBlock = blocks.find(b => {
                    let found = false;
                    b.mesh.traverse(c => { if (c === hitMesh) found = true; });
                    return found;
                });
            }

            // Fallback: Check 2D distance on screen (100px tolerance)
            if (!closestBlock) {
                const pinchScreenPxX = (coords.x + 1) / 2 * window.innerWidth;
                const pinchScreenPxY = -(coords.y - 1) / 2 * window.innerHeight;
                let minScreenDist = Infinity;

                for (const block of blocks) {
                    const blockPos = block.mesh.position.clone();
                    blockPos.project(camera);
                    
                    if (blockPos.z > 1) continue; // Behind camera
                    
                    const blockScreenPxX = (blockPos.x + 1) / 2 * window.innerWidth;
                    const blockScreenPxY = -(blockPos.y - 1) / 2 * window.innerHeight;
                    const dist = getDistance({x: pinchScreenPxX, y: pinchScreenPxY}, {x: blockScreenPxX, y: blockScreenPxY});
                    
                    if (dist < 100 && dist < minScreenDist) {
                        minScreenDist = dist;
                        closestBlock = block;
                    }
                }
            }

            if (deleteMode) {
                if (isAnyPinching && closestBlock && btnCooldown === 0) {
                    scene.remove(closestBlock.mesh);
                    disposeBlockMesh(closestBlock);
                    try { world.remove(closestBlock.body); } catch (e) {}
                    blocks = blocks.filter(b => b !== closestBlock);
                    if (grabbedBlock === closestBlock) grabbedBlock = null;
                    btnCooldown = 25;
                }
            } else {
                if (selectionCooldown > 0) selectionCooldown--;
                const pinchStart = isHand1Pinching && !prevPinch;
                
                if (pinchStart && selectionCooldown === 0 && closestBlock && btnCooldown < 20) {
                    closestBlock.isSelected = !closestBlock.isSelected;
                    if (closestBlock.isSelected) {
                        setBlockEmissive(closestBlock, 0x222222, 0.9);
                    } else {
                        setBlockEmissive(closestBlock, 0x000000, 0.0);
                    }
                    selectionCooldown = 30;
                    btnCooldown = 20;
                }
                prevPinch = isHand1Pinching;

                if (grabbedBlock) {
                    if (!isScalingNow && isAnyPinching) {
                        if (_raycaster.ray.intersectPlane(dragPlane, _intersectPoint)) {
                            grabbedBlock.body.type = CANNON.Body.KINEMATIC;
                            
                            const targetPos = _intersectPoint.clone().add(grabOffset);
                            grabbedBlock.body.position.set(targetPos.x, targetPos.y, targetPos.z);
                            grabbedBlock.body.velocity.set(0, 0, 0);
                            grabbedBlock.body.angularVelocity.set(0, 0, 0);

                            grabbedBlock.mesh.position.copy(grabbedBlock.body.position);
                            setBlockColor(grabbedBlock, 0xff0000);
                        }
                    } else if (!isAnyPinching) {
                        grabbedBlock.body.type = CANNON.Body.DYNAMIC;
                        grabbedBlock.body.velocity.set(0, 0, 0);
                        grabbedBlock.body.angularVelocity.set(0, 0, 0);
                        grabbedBlock.isGrabbed = false;
                        setBlockColor(grabbedBlock, grabbedBlock.baseColor);
                        grabbedBlock = null;
                    }
                } else if (!isScalingNow && isAnyPinching && closestBlock && btnCooldown < 20) {
                    grabbedBlock = closestBlock;
                    grabbedBlock.isGrabbed = true;
                    grabbedBlock.body.type = CANNON.Body.KINEMATIC;
                    grabbedBlock.body.velocity.set(0, 0, 0);
                    grabbedBlock.body.angularVelocity.set(0, 0, 0);
                    setBlockColor(grabbedBlock, 0xff0000);

                    const camDir = new THREE.Vector3();
                    camera.getWorldDirection(camDir);
                    dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), grabbedBlock.mesh.position);
                    
                    if (_raycaster.ray.intersectPlane(dragPlane, _intersectPoint)) {
                        grabOffset.copy(grabbedBlock.body.position).sub(_intersectPoint);
                    } else {
                        grabOffset.set(0, 0, 0);
                    }
                }
            }
        }

        for (const block of blocks) {
            if (!block.isGrabbed && (!grabbedBlock || grabbedBlock !== block || !isScaling)) {
                setBlockColor(block, block.baseColor);
            }
        }

    } else {
        isScaling = false;
        if (grabbedBlock) {
            grabbedBlock.isGrabbed = false;
            grabbedBlock.body.type = CANNON.Body.DYNAMIC;
            grabbedBlock.body.velocity.set(0, 0, 0);
            grabbedBlock.body.angularVelocity.set(0, 0, 0);
            setBlockColor(grabbedBlock, grabbedBlock.baseColor);
            grabbedBlock = null;
        }
    }
});

function animate() {
    requestAnimationFrame(animate);

    applyDeviceOrientation();
    world.step(1 / 60);

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];

        if (!block.isGrabbed) {
            block.mesh.position.copy(block.body.position);
            block.mesh.quaternion.copy(block.body.quaternion);
        } else {
            block.mesh.rotation.x += 0.02;
            block.mesh.rotation.y += 0.02;
            block.body.quaternion.copy(block.mesh.quaternion);
        }

        if (block.body.position.y < -15) {
            scene.remove(block.mesh);
            disposeBlockMesh(block);
            try { world.remove(block.body); } catch (e) {}
            blocks.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

animate();

function showScreen(name) {
    document.getElementById('screen-home')?.classList.toggle('active', name === 'home');
    document.getElementById('screen-builder')?.classList.toggle('active', name === 'builder');
}

document.getElementById('nav-home')?.addEventListener('click', () => showScreen('home'));
document.getElementById('nav-builder')?.addEventListener('click', () => showScreen('builder'));
document.getElementById('nav-home-2')?.addEventListener('click', () => showScreen('home'));
document.getElementById('nav-builder-2')?.addEventListener('click', () => showScreen('builder'));

let selectedBlock = null;
document.getElementById('carousel')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    
    if (selectedBlock) selectedBlock.style.outline = 'none';
    selectedBlock = btn;
    selectedBlock.style.outline = '3px solid rgba(0,0,0,0.12)';
    
    const shape = btn.dataset.shape || 'cube';
    
    let color = 0x2B9CFF;
    if (btn.classList.contains('yellow')) color = 0xFFD24D;
    if (btn.classList.contains('green')) color = 0x39C07A;
    if (btn.classList.contains('red')) color = 0xFF6B6B;
    if (btn.classList.contains('purple')) color = 0x9b59b6;
    
    createOrUpdateBlock(shape, color);
});

document.getElementById('camera-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    toggleCamera();
    btn.style.transform = 'scale(0.96)';
    setTimeout(() => btn.style.transform = '', 150);
});

const btnDelete = document.getElementById('btn-delete');
if (btnDelete) {
    btnDelete.addEventListener('click', () => {
        deleteMode = !deleteMode;
        btnDelete.classList.toggle('active', deleteMode);
    });
}

const btnSwitchCam = document.getElementById('btn-switch-cam');
if (btnSwitchCam) {
    btnSwitchCam.addEventListener('click', () => {
        switchCamera();
        btnSwitchCam.style.transform = 'scale(0.9)';
        setTimeout(() => btnSwitchCam.style.transform = '', 150);
    });
}

const btnGridUp = document.getElementById('btn-grid-up');
const btnGridDown = document.getElementById('btn-grid-down');

function adjustGridHeight(delta) {
    floorY += delta;
    gridHelper.position.y = floorY;
    floor.position.y = floorY;
    groundBody.position.y = floorY;
}

if (btnGridUp) {
    btnGridUp.addEventListener('click', () => {
        adjustGridHeight(0.5);
        btnGridUp.style.transform = 'scale(0.9)';
        setTimeout(() => btnGridUp.style.transform = '', 150);
    });
}

if (btnGridDown) {
    btnGridDown.addEventListener('click', () => {
        adjustGridHeight(-0.5);
        btnGridDown.style.transform = 'scale(0.9)';
        setTimeout(() => btnGridDown.style.transform = '', 150);
    });
}

function createOrUpdateBlock(shape, colorHex) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    
    let spawnPos = new THREE.Vector3();
    
    if (dir.y < -0.1) {
        const distanceToFloor = (floorY + 1 - camera.position.y) / dir.y; 
        if (distanceToFloor > 0 && distanceToFloor < 30) {
            spawnPos = camera.position.clone().add(dir.multiplyScalar(distanceToFloor));
        } else {
            spawnPos = camera.position.clone().add(dir.multiplyScalar(10));
            if (spawnPos.y < floorY + 1) spawnPos.y = floorY + 1;
        }
    } else {
        spawnPos = camera.position.clone().add(dir.multiplyScalar(10));
        if (spawnPos.y < floorY + 1) spawnPos.y = floorY + 1;
    }

    spawnBlock(shape, colorHex, spawnPos.x, spawnPos.y, spawnPos.z);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});