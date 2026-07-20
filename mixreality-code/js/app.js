// ==========================================
// 1. SETUP THREE.JS (Dunia & Objek)
// ==========================================
const canvas = document.getElementById('output_canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight.position.set(5, 12, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 25;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
scene.add(dirLight);

// Fungsi untuk membuat tekstur lantai kotak-kotak (checkered/grid floor)
function createCheckeredTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Warna ubin 1
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);

    // Warna ubin 2
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);

    // Garis pembatas kotak-kotak agar lebih presisi
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 128, 128);
    ctx.strokeRect(0, 0, 64, 64);
    ctx.strokeRect(64, 64, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Sesuaikan repetisi agar ukuran kotak proporsional (lebar 20, tinggi 10)
    texture.repeat.set(20, 10);
    return texture;
}

// Lantai Virtual (Batas Bawah Studio)
const floorY = -3;
const floorGeometry = new THREE.PlaneGeometry(20, 10);
const floorTexture = createCheckeredTexture();
const floorMaterial = new THREE.MeshBasicMaterial({
    map: floorTexture,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = Math.PI / -2;
floor.position.y = floorY;
scene.add(floor);

// Lantai Bayangan Realistis Mode AR Dunia Nyata (ShadowMaterial)
const arShadowMaterial = new THREE.ShadowMaterial({ opacity: 0.35 });
const arShadowFloor = new THREE.Mesh(floorGeometry, arShadowMaterial);
arShadowFloor.rotation.x = Math.PI / -2;
arShadowFloor.position.y = floorY;
arShadowFloor.receiveShadow = true;
arShadowFloor.visible = false; // Aktif saat kamera belakang (AR Mode)
scene.add(arShadowFloor);

// Reticle Penanda Deteksi Permukaan Dunia Nyata (AR Placement Ring)
const reticleGeo = new THREE.RingGeometry(0.35, 0.48, 32);
const reticleMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85
});
const arReticle = new THREE.Mesh(reticleGeo, reticleMat);
arReticle.rotation.x = Math.PI / -2;
arReticle.position.set(0, floorY + 0.02, 0);
arReticle.visible = false; // Aktif saat Kamera Belakang (AR Mode)
scene.add(arReticle);

// ==========================================
// 1B. SETUP PHYSICS (CANNON.JS)
// ==========================================
const world = new CANNON.World();
world.gravity.set(0, -38, 0); // Gravitasi disesuaikan agar terasa nyata dan cepat pada skala visual ini
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 40; // Tingkatkan dari 10 ke 40 untuk kestabilan penumpukan tinggi
world.allowSleep = true; // Izinkan objek tidur (beku) jika diam untuk menghilangkan getaran

// Material fisika untuk interaksi (Friction & Restitution)
const groundMaterial = new CANNON.Material("groundMaterial");
const blockMaterial = new CANNON.Material("blockMaterial");

// Kontak antara balok dengan lantai (Friction tinggi, kontak kaku)
const groundBlockContact = new CANNON.ContactMaterial(groundMaterial, blockMaterial, {
    friction: 0.9,
    restitution: 0.05,
    contactEquationStiffness: 1e7,
    contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e7,
    frictionEquationRelaxation: 3
});
world.addContactMaterial(groundBlockContact);

// Kontak sesama balok (Friction maksimal, tanpa pantulan, kontak kaku untuk kestabilan tumpukan)
const blockBlockContact = new CANNON.ContactMaterial(blockMaterial, blockMaterial, {
    friction: 1.0,
    restitution: 0.0,
    contactEquationStiffness: 1e7,
    contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e7,
    frictionEquationRelaxation: 3
});
world.addContactMaterial(blockBlockContact);

// Lantai Fisika (Cannon.js Plane menghadap ke atas)
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({
    mass: 0, // statis
    shape: groundShape,
    material: groundMaterial
});
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
groundBody.position.set(0, floorY, 0);
world.addBody(groundBody);

// Array untuk menyimpan semua balok di scene
let blocks = [];
let deleteMode = false;
let grabbedBlock = null;
let activePaintColor = null;
let currentFacingMode = 'user'; // 'user' (front/selfie) or 'environment' (rear/back)

// Game Mode State Variables (Susun Balok)
let isGameMode = false;
let currentGameLevel = null;
let gameWinChecked = false;
let blueprintObjects = [];

const blueprintsData = {
    easy: {
        name: "Menara Dasar (Mudah)",
        items: [
            { shape: 'plank', pos: { x: 0, y: floorY + 0.25, z: 0 }, scale: 0.5, color: 0xFFD24D },
            { shape: 'cube', pos: { x: 0, y: floorY + 0.5 + 0.5, z: 0 }, scale: 0.5, color: 0x2B9CFF },
            { shape: 'tri', pos: { x: 0, y: floorY + 1.0 + 0.5 + 0.6, z: 0 }, scale: 0.5, color: 0xFF6B6B }
        ]
    },
    medium: {
        name: "Menara Gerbang (Sedang)",
        items: [
            { shape: 'arch', pos: { x: 0, y: floorY + 0.7, z: 0 }, scale: 0.5, color: 0xFF6B6B },
            { shape: 'plank', pos: { x: 0, y: floorY + 1.4 + 0.25, z: 0 }, scale: 0.5, color: 0xFFD24D },
            { shape: 'cylinder', pos: { x: -0.6, y: floorY + 1.65 + 0.25 + 0.6, z: 0 }, scale: 0.5, color: 0xFF9D00 },
            { shape: 'cylinder', pos: { x: 0.6, y: floorY + 1.65 + 0.25 + 0.6, z: 0 }, scale: 0.5, color: 0xFF9D00 }
        ]
    },
    hard: {
        name: "Kastil Megah (Sulit)",
        items: [
            { shape: 'arch', pos: { x: 0, y: floorY + 0.7, z: 0 }, scale: 0.5, color: 0xFF6B6B },
            { shape: 'cube', pos: { x: -1.5, y: floorY + 0.5, z: 0 }, scale: 0.5, color: 0x2B9CFF },
            { shape: 'cube', pos: { x: 1.5, y: floorY + 0.5, z: 0 }, scale: 0.5, color: 0x2B9CFF },
            { shape: 'plank', pos: { x: 0, y: floorY + 1.65, z: 0 }, scale: 0.5, color: 0xFFD24D },
            { shape: 'pyramid', pos: { x: -1.5, y: floorY + 1.0 + 0.6, z: 0 }, scale: 0.5, color: 0x39C07A },
            { shape: 'pyramid', pos: { x: 1.5, y: floorY + 1.0 + 0.6, z: 0 }, scale: 0.5, color: 0x39C07A }
        ]
    }
};

// --- SISTEM UNDO & REDO ---
const undoStack = [];
const redoStack = [];

function recordAction(action) {
    undoStack.push(action);
    redoStack.length = 0; // Bersihkan riwayat redo saat ada aksi baru
}

function removeBlockFromSimulation(blockObj) {
    scene.remove(blockObj.mesh);
    try { world.remove(blockObj.body); } catch (e) { }
    blocks = blocks.filter(b => b !== blockObj);
    if (grabbedBlock === blockObj) grabbedBlock = null;
}

function addBlockToSimulation(blockObj) {
    scene.add(blockObj.mesh);
    try { world.addBody(blockObj.body); } catch (e) { }
    // Reset posisi dan kecepatan fisika agar stabil
    blockObj.body.velocity.set(0, 0, 0);
    blockObj.body.angularVelocity.set(0, 0, 0);
    blocks.push(blockObj);
}

function cleanStacksOfBlock(blockObj) {
    for (let i = undoStack.length - 1; i >= 0; i--) {
        if (undoStack[i].blockObj === blockObj) {
            undoStack.splice(i, 1);
        }
    }
    for (let i = redoStack.length - 1; i >= 0; i--) {
        if (redoStack[i].blockObj === blockObj) {
            redoStack.splice(i, 1);
        }
    }
}

function executeUndo() {
    if (undoStack.length === 0) {
        updateStatus('Tidak ada aksi untuk Undo.', true);
        return;
    }
    const action = undoStack.pop();
    if (action.type === 'spawn') {
        removeBlockFromSimulation(action.blockObj);
    } else if (action.type === 'delete') {
        addBlockToSimulation(action.blockObj);
    } else if (action.type === 'color_multi') {
        action.changes.forEach(change => {
            change.blockObj.baseColor = change.oldColor;
            change.blockObj.mesh.material.color.setHex(change.oldColor);
        });
    } else if (action.type === 'move') {
        action.blockObj.body.position.set(action.oldPos.x, action.oldPos.y, action.oldPos.z);
        action.blockObj.body.quaternion.set(action.oldRot.x, action.oldRot.y, action.oldRot.z, action.oldRot.w);
        action.blockObj.mesh.position.copy(action.blockObj.body.position);
        action.blockObj.mesh.quaternion.copy(action.blockObj.body.quaternion);
        action.blockObj.body.velocity.set(0, 0, 0);
        action.blockObj.body.angularVelocity.set(0, 0, 0);
    } else if (action.type === 'scale') {
        action.blockObj.mesh.scale.set(action.oldScale, action.oldScale, action.oldScale);
        updatePhysicsShape(action.blockObj, action.oldScale);
    }
    redoStack.push(action);
    updateStatus('Undo berhasil.');
}

function executeRedo() {
    if (redoStack.length === 0) {
        updateStatus('Tidak ada aksi untuk Redo.', true);
        return;
    }
    const action = redoStack.pop();
    if (action.type === 'spawn') {
        addBlockToSimulation(action.blockObj);
    } else if (action.type === 'delete') {
        removeBlockFromSimulation(action.blockObj);
    } else if (action.type === 'color_multi') {
        action.changes.forEach(change => {
            change.blockObj.baseColor = change.newColor;
            change.blockObj.mesh.material.color.setHex(change.newColor);
        });
    } else if (action.type === 'move') {
        action.blockObj.body.position.set(action.newPos.x, action.newPos.y, action.newPos.z);
        action.blockObj.body.quaternion.set(action.newRot.x, action.newRot.y, action.newRot.z, action.newRot.w);
        action.blockObj.mesh.position.copy(action.blockObj.body.position);
        action.blockObj.mesh.quaternion.copy(action.blockObj.body.quaternion);
        action.blockObj.body.velocity.set(0, 0, 0);
        action.blockObj.body.angularVelocity.set(0, 0, 0);
    } else if (action.type === 'scale') {
        action.blockObj.mesh.scale.set(action.newScale, action.newScale, action.newScale);
        updatePhysicsShape(action.blockObj, action.newScale);
    }
    undoStack.push(action);
    updateStatus('Redo berhasil.');
}

// Fungsi Menghapus & Mengupdate Shape Fisika (saat discale)
function updatePhysicsShape(block, scale) {
    // Bersihkan array shape secara langsung karena removeShape mungkin tidak tersedia di versi ini
    block.body.shapes.length = 0;
    block.body.shapeOffsets.length = 0;
    block.body.shapeOrientations.length = 0;

    let physicsShape;
    let shapeOrientation = null;

    switch (block.shape) {
        case 'cube':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1 * scale, 1 * scale, 1 * scale));
            break;
        case 'plank':
            physicsShape = new CANNON.Box(new CANNON.Vec3(2 * scale, 0.5 * scale, 1 * scale));
            break;
        case 'tri':
        case 'pyramid':
            physicsShape = new CANNON.Cylinder(0, 1.6 * scale, 2.4 * scale, 8);
            shapeOrientation = new CANNON.Quaternion();
            shapeOrientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            break;
        case 'cylinder':
            physicsShape = new CANNON.Cylinder(0.8 * scale, 0.8 * scale, 2.4 * scale, 12);
            shapeOrientation = new CANNON.Quaternion();
            shapeOrientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            break;
        case 'halfsphere':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.2 * scale, 0.6 * scale, 1.2 * scale));
            break;
        case 'arch':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.8 * scale, 1.4 * scale, 1 * scale));
            break;
        case 'pent':
            physicsShape = new CANNON.Sphere(1.6 * scale);
            break;
        default:
            physicsShape = new CANNON.Box(new CANNON.Vec3(1 * scale, 1 * scale, 1 * scale));
    }
    block.body.addShape(physicsShape, new CANNON.Vec3(0, 0, 0), shapeOrientation);
    block.body.updateMassProperties();
    block.body.updateBoundingRadius();
    block.body.computeAABB();
    block.body.wakeUp(); // Bangunkan bodi fisik saat ukurannya diubah
}

// Fungsi Menambahkan Balok Baru ke Scene (dengan rigid body fisika)
function spawnBlock(shape, colorHex, x = 0, y = 0, z = 0) {
    let geo;
    switch (shape) {
        case 'cube': geo = new THREE.BoxGeometry(2, 2, 2); break;
        case 'plank': geo = new THREE.BoxGeometry(4, 1, 2); break;
        case 'tri': geo = new THREE.ConeGeometry(1.6, 2.4, 3); break;
        case 'pyramid': geo = new THREE.ConeGeometry(1.6, 2.4, 4); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(0.8, 0.8, 2.4, 16); break;
        case 'halfsphere': geo = new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); break;
        case 'arch': {
            // Gapura: kotak dengan lubang setengah lingkaran di bawah
            const archShape = new THREE.Shape();
            archShape.moveTo(-1.8, -1.4);
            archShape.lineTo(-1.8, 1.4);
            archShape.lineTo(1.8, 1.4);
            archShape.lineTo(1.8, -1.4);
            archShape.lineTo(0.9, -1.4);
            archShape.absarc(0, -1.4, 0.9, 0, Math.PI, false);
            archShape.lineTo(-0.9, -1.4);
            const extrudeSettings = { depth: 1.6, bevelEnabled: false };
            geo = new THREE.ExtrudeGeometry(archShape, extrudeSettings);
            geo.translate(0, 0, -0.8);
            break;
        }
        case 'pent': geo = new THREE.DodecahedronGeometry(1.6); break;
        default: geo = new THREE.BoxGeometry(2, 2, 2);
    }
    const mat = new THREE.MeshPhongMaterial({ color: colorHex || 0x00ff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    // Set ukuran awal menjadi 50% (skala 0.5)
    mesh.scale.set(0.5, 0.5, 0.5);
    scene.add(mesh);

    // --- FISIKA CANNON.JS ---
    let physicsShape;
    let shapeOrientation = null;
    switch (shape) {
        case 'cube':
            physicsShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
            break;
        case 'plank':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1, 0.25, 0.5));
            break;
        case 'tri':
        case 'pyramid':
            // Cone: top radius 0, bottom radius 0.8, height 1.2
            physicsShape = new CANNON.Cylinder(0, 0.8, 1.2, 8);
            shapeOrientation = new CANNON.Quaternion();
            shapeOrientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            break;
        case 'cylinder':
            // Cylinder: top radius 0.4, bottom radius 0.4, height 1.2
            physicsShape = new CANNON.Cylinder(0.4, 0.4, 1.2, 12);
            shapeOrientation = new CANNON.Quaternion();
            shapeOrientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            break;
        case 'halfsphere':
            physicsShape = new CANNON.Box(new CANNON.Vec3(0.6, 0.3, 0.6));
            break;
        case 'arch':
            physicsShape = new CANNON.Box(new CANNON.Vec3(0.9, 0.7, 0.5));
            break;
        case 'pent':
            physicsShape = new CANNON.Sphere(0.8);
            break;
        default:
            physicsShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    }

    const body = new CANNON.Body({
        mass: 1, // dinamis
        material: blockMaterial
    });
    body.addShape(physicsShape, new CANNON.Vec3(0, 0, 0), shapeOrientation);

    // Konfigurasi tidur (sleep) agar tumpukan stabil dan tidak bergetar/bergeser sendiri
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.05; // Lebih sensitif (kecepatan < 0.05 m/s)
    body.sleepTimeLimit = 1.0;  // Harus benar-benar diam selama 1.0 detik sebelum beku

    body.computeAABB();
    body.position.set(x, y, z);
    world.addBody(body);
    body.wakeUp(); // Bangunkan bodi agar gravitasi langsung bekerja saat spawn

    const blockObj = {
        mesh: mesh,
        shape: shape,
        body: body,
        baseColor: colorHex || 0x00ff00,
        velocityY: 0,
        isGrabbed: false,
        isSelected: false
    };
    blocks.push(blockObj);

    // Catat aksi spawn untuk undo
    recordAction({ type: 'spawn', blockObj: blockObj });

    return blockObj;
}

// Objek Balok Awal (Kubus Hijau)
spawnBlock('cube', 0x00ff00, 0, 0, 0);

// --- TOMBOL VIRTUAL 3D (ON/OFF TRACKING) ---
const btnGeo = new THREE.BoxGeometry(1.6, 0.4, 0.1);
const btnMat = new THREE.MeshPhongMaterial({ color: 0xff9d00 }); // Warna awal jingga
const virtualBtn = new THREE.Mesh(btnGeo, btnMat);
virtualBtn.position.set(6.5, 3.7, 0); // Posisinya di Kanan Atas layar
scene.add(virtualBtn);

// ==========================================
// 2. VARIABEL & ELEMEN HTML
// ==========================================
let isGrabbed = false;
let velocityY = 0;
const gravity = 0.08;
let isScaling = false;
let initialHandsDistance = 0;
let initialBalokScale = 1;

// Selection / pinch helpers
let prevPinch = false;
let selectionCooldown = 0;
let isSelected = false;
let pinchReleaseCounter = 0; // Grace period frame buffer to prevent accidental drops

let showTracking = false;
let cameraActive = false;
let btnCooldown = 0;
let cameraUtils;

const trackingCanvas = document.getElementById('tracking_canvas');
const trackingCtx = trackingCanvas.getContext('2d');
trackingCanvas.width = window.innerWidth;
trackingCanvas.height = window.innerHeight;

const videoElement = document.getElementById('webcam');
const btnTracking = document.getElementById('btn-tracking');
const statusEl = document.getElementById('status');
const cameraBtn = document.getElementById('camera-btn');

// ==========================================
// 3. FUNGSI BANTUAN MATEMATIKA & KAMERA
// ==========================================
function mapTo3DSpace(x, y) {
    const targetX = (currentFacingMode === 'user') ? (1 - x) : x;
    
    if (currentFacingMode === 'environment') {
        const ndcX = targetX * 2 - 1;
        const ndcY = -(y * 2 - 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        
        // Raycast ke bidang horisontal meja (y = floorY + 0.5)
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(floorY + 0.5));
        const intersection = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(floorPlane, intersection)) {
            return { x: intersection.x, y: intersection.y, z: intersection.z };
        }
    }
    
    const aspect = window.innerWidth / window.innerHeight;
    const visibleHeight = 8.28;
    const visibleWidth = visibleHeight * aspect;
    return {
        x: (targetX - 0.5) * visibleWidth,
        y: -(y - 0.5) * visibleHeight,
        z: 0
    };
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

// Fungsi Menyalakan Kamera Tanpa Bentrok
function startCamera() {
    updateStatus('Meminta akses kamera...');

    if (!cameraUtils) {
        cameraUtils = new Camera(videoElement, {
            onFrame: async () => {
                if (videoElement.readyState >= 2) {
                    await hands.send({ image: videoElement });
                }
            },
            width: 640,
            height: 480,
            facingMode: currentFacingMode
        });
    }

    cameraUtils.start()
        .then(() => {
            updateStatus('Kamera aktif. Tunjukkan tangan ke depan kamera.');
            // show tracking by default when camera starts
            showTracking = true;
            cameraActive = true;
            virtualBtn.material.color.setHex(0x00ff00);
            if (cameraBtn) cameraBtn.classList.add('active');
        })
        .catch((error) => {
            console.error('Gagal mengakses kamera:', error);
            updateStatus('Gagal menyalakan kamera. Izinkan kamera di browser.', true);
            cameraActive = false;
            if (cameraBtn) cameraBtn.classList.remove('active');
        });
}

// Fungsi Mematikan Kamera
function stopCamera() {
    if (cameraUtils) {
        try { cameraUtils.stop(); } catch (e) { }
        cameraUtils = null;
    }
    // Hentikan track video secara manual untuk mematikan lampu indikator kamera
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
    cameraActive = false;
    showTracking = false;
    virtualBtn.material.color.setHex(0xff9d00); // orange
    updateStatus('Kamera dinonaktifkan.');
    if (cameraBtn) cameraBtn.classList.remove('active');
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
}

// Fungsi Toggle Kamera On/Off
function toggleCamera() {
    if (cameraActive) {
        stopCamera();
    } else {
        startCamera();
    }
}

// Fungsi Memutar/Flip Kamera (Depan <-> Belakang / Mode AR Dunia Nyata)
function flipCamera() {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';

    // Terapkan efek cermin ke video dan tracking canvas jika kamera depan, dan hilangkan jika kamera belakang
    if (currentFacingMode === 'user') {
        videoElement.style.transform = 'scaleX(-1)';
        trackingCanvas.style.transform = 'scaleX(-1)';
        floor.visible = true; // Tampilkan kembali lantai ubin studio
        arShadowFloor.visible = false;
        if (arReticle) arReticle.visible = false;

        // Reset posisi kamera ke pandangan studio standar
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);

        updateStatus('Mode Kamera Depan (Selfie Studio).');
    } else {
        videoElement.style.transform = 'none';
        trackingCanvas.style.transform = 'none';
        floor.visible = false; // Sembunyikan ubin buatan agar lantai dunia nyata dari kamera terlihat 100%
        arShadowFloor.visible = true; // Aktifkan lantai bayangan realistis di atas video dunia nyata
        if (arReticle) arReticle.visible = true; // Aktifkan penanda deteksi dataran AR

        resetARWorldAnchor(); // Kunci penjangkaran objek ke meja fisik di dunia nyata
        requestGyroPermission(); // Minta izin sensor gyro (wajib di iOS 13+)

        // Cek ketersediaan WebXR untuk AR 6DoF sejati
        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-ar').then(ok => {
                if (ok) updateStatus('Mode AR Aktif 📍. Ketuk tombol 👓 untuk AR 6DoF sejati (objek terkunci 100% di meja)! Atau geser layar untuk orbit manual.');
            });
        }
        updateStatus('Mode AR Aktif 📍. Putar/miringkan HP untuk melihat objek dari sudut berbeda. Geser layar untuk orbit manual 360°.');
    }

    // Jika kamera sedang aktif, hentikan & jalankan kembali dengan facingMode baru
    if (cameraActive) {
        if (cameraUtils) {
            try { cameraUtils.stop(); } catch (e) { }
            cameraUtils = null;
        }
        if (videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
        }
        startCamera();
    }
}

// Event Listener Tombol Fisik (HTML)
if (btnTracking) {
    btnTracking.addEventListener('click', () => {
        startCamera();
        btnTracking.style.display = 'none'; // Sembunyikan tombol fisik

        // Default langsung nyalakan tracking
        showTracking = true;
        virtualBtn.material.color.setHex(0x00ff00);
    });
}

// ==========================================
// 4. LOGIKA DETEKSI TANGAN (MediaPipe)
// ==========================================
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

hands.onResults((results) => {
    // 4A. MENGGAMBAR GARIS TRACKING & KURSOR HAND POINTER
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

        const pinchDist1 = getDistance(hand1[4], hand1[8]);
        const pinchDist2 = hand2 ? getDistance(hand2[4], hand2[8]) : 1;

        // Ambang batas cubitan: lebih longgar (0.13) saat sedang memegang balok agar tidak mudah terlepas
        const pinchThreshold = grabbedBlock ? 0.13 : 0.085;
        const isHand1Pinching = pinchDist1 < pinchThreshold;
        const isHand2Pinching = hand2 ? pinchDist2 < pinchThreshold : false;
        const isAnyPinching = isHand1Pinching || isHand2Pinching;

        // Penanganan buffer frame pelepasan (hysteresis) untuk mencegah balok terlepas tidak sengaja
        if (grabbedBlock) {
            if (isAnyPinching) {
                pinchReleaseCounter = 0;
            } else {
                pinchReleaseCounter++;
            }
        } else {
            pinchReleaseCounter = 0;
        }
        const isStillHolding = isAnyPinching || (grabbedBlock && pinchReleaseCounter < 8);

        const midX1 = (hand1[4].x + hand1[8].x) / 2;
        const midY1 = (hand1[4].y + hand1[8].y) / 2;
        const pos3D = mapTo3DSpace(midX1, midY1);

        // Visual feedback kursor pointer tangan di layar
        if (showTracking) {
            // Karena canvas memiliki CSS transform: scaleX(-1) pada kamera depan,
            // koordinat mentah MediaPipe (midX1) secara otomatis di-cermin oleh CSS!
            const rawCursorX = (currentFacingMode === 'user' ? midX1 : (1 - midX1)) * trackingCanvas.width;
            const cursorY = midY1 * trackingCanvas.height;

            trackingCtx.beginPath();
            trackingCtx.arc(rawCursorX, cursorY, isStillHolding ? 16 : 10, 0, Math.PI * 2);
            trackingCtx.fillStyle = isStillHolding ? 'rgba(255, 215, 0, 0.9)' : 'rgba(0, 255, 255, 0.75)';
            trackingCtx.fill();
            trackingCtx.lineWidth = 3;
            trackingCtx.strokeStyle = '#FFFFFF';
            trackingCtx.stroke();

            if (isStillHolding) {
                trackingCtx.save();
                trackingCtx.translate(rawCursorX, cursorY);
                // Un-mirror teks jika canvas menggunakan CSS scaleX(-1) agar teks tidak terbalik
                if (currentFacingMode === 'user') trackingCtx.scale(-1, 1);
                trackingCtx.font = 'bold 13px sans-serif';
                trackingCtx.fillStyle = '#FFFFFF';
                trackingCtx.fillText('✊ PINCH', currentFacingMode === 'user' ? -60 : 20, 4);
                trackingCtx.restore();
            }
        }

        // --- PINCH TO CLICK OR HOLD HTML BUTTONS ---
        let clickedHTMLButton = false;
        if (isHand1Pinching) {
            // Front camera mirrors X, rear camera does not
            const screenX = (currentFacingMode === 'user') ? (1 - midX1) * window.innerWidth : midX1 * window.innerWidth;
            const screenY = midY1 * window.innerHeight;
            const element = document.elementFromPoint(screenX, screenY);
            if (element) {
                const button = element.closest('button');
                if (button) {
                    if (button.classList.contains('scroll-btn')) {
                        const direction = button.id === 'btn-scroll-up' ? -5 : 5;
                        carouselWrapper.scrollBy({ top: direction, behavior: 'auto' });
                        clickedHTMLButton = true;
                    } else if (btnCooldown === 0) {
                        button.click();
                        btnCooldown = 30;
                        clickedHTMLButton = true;
                    }
                }
            }
        }

        if (!clickedHTMLButton) {
            // 4B. LOGIKA TOMBOL VIRTUAL
            const distToBtnX = Math.abs(pos3D.x - virtualBtn.position.x);
            const distToBtnY = Math.abs(pos3D.y - virtualBtn.position.y);

            if (isHand1Pinching && distToBtnX < 2 && distToBtnY < 1 && btnCooldown === 0) {
                showTracking = !showTracking;
                virtualBtn.material.color.setHex(showTracking ? 0x00ff00 : 0xff9d00);
                btnCooldown = 30;
            }

            // 4C. LOGIKA SCALING (2 Tangan)
            let isScalingNow = false;
            if (hand2 && isHand1Pinching && isHand2Pinching && grabbedBlock) {
                isScalingNow = true;
                const currentDistance = getDistance(hand1[8], hand2[8]);

                if (!isScaling) {
                    isScaling = true;
                    initialHandsDistance = currentDistance;
                    initialBalokScale = grabbedBlock.mesh.scale.x;
                } else {
                    let scaleFactor = currentDistance / initialHandsDistance;
                    let newScale = initialBalokScale * scaleFactor;
                    newScale = Math.max(0.25, Math.min(newScale, 3));

                    grabbedBlock.mesh.scale.set(newScale, newScale, newScale);
                    grabbedBlock.mesh.material.color.setHex(0xffff00);
                    updatePhysicsShape(grabbedBlock, newScale);
                }
            }

            if (!isScalingNow) {
                if (isScaling && grabbedBlock) {
                    const finalScale = grabbedBlock.mesh.scale.x;
                    if (Math.abs(finalScale - initialBalokScale) > 0.01) {
                        recordAction({
                            type: 'scale',
                            blockObj: grabbedBlock,
                            oldScale: initialBalokScale,
                            newScale: finalScale
                        });
                    }
                }
                isScaling = false;
            }

            // DETEKSI BALOK TERDEKAT DENGAN RAYCASTING 3D SEJATI
            let closestBlock = null;
            const targetX = (currentFacingMode === 'user') ? (1 - midX1) : midX1;
            const ndcX = targetX * 2 - 1;
            const ndcY = -(midY1 * 2 - 1);
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
            
            // Raycast langsung ke mesh 3D semua balok di scene
            const intersects = raycaster.intersectObjects(blocks.map(b => b.mesh));
            if (intersects.length > 0) {
                const hitMesh = intersects[0].object;
                closestBlock = blocks.find(b => b.mesh === hitMesh);
            } else {
                // Fallback: jarak 3D ke posisi target pos3D
                let minDistance = Infinity;
                for (const block of blocks) {
                    const hitArea = block.mesh.scale.x * 2.5;
                    const dx = pos3D.x - block.mesh.position.x;
                    const dy = pos3D.y - block.mesh.position.y;
                    const dz = (pos3D.z !== undefined ? pos3D.z : 0) - block.mesh.position.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < hitArea && dist < minDistance) {
                        minDistance = dist;
                        closestBlock = block;
                    }
                }
            }

            if (deleteMode) {
                // LOGIKA HAPUS (DELETE MODE)
                if (isAnyPinching && closestBlock && btnCooldown === 0) {
                    recordAction({ type: 'delete', blockObj: closestBlock });
                    removeBlockFromSimulation(closestBlock);
                    btnCooldown = 25;
                    updateStatus('Balok berhasil dihapus.');
                }
            } else {
                // LOGIKA GRABBING & SELECTION (NORMAL MODE)
                if (selectionCooldown > 0) selectionCooldown--;
                const pinchStart = isHand1Pinching && !prevPinch;
                if (pinchStart && selectionCooldown === 0 && closestBlock && btnCooldown < 20 && activePaintColor === null) {
                    closestBlock.isSelected = !closestBlock.isSelected;
                    if (closestBlock.isSelected) {
                        closestBlock.mesh.material.emissive = new THREE.Color(0x222222);
                        closestBlock.mesh.material.emissiveIntensity = 0.9;
                    } else {
                        closestBlock.mesh.material.emissive = new THREE.Color(0x000000);
                        closestBlock.mesh.material.emissiveIntensity = 0.0;
                    }
                    selectionCooldown = 30;
                    btnCooldown = 20;
                }
                prevPinch = isHand1Pinching;

                if (grabbedBlock) {
                    if (!isScalingNow && isStillHolding) {
                        grabbedBlock.body.type = CANNON.Body.KINEMATIC;
                        const targetZ = pos3D.z !== undefined ? pos3D.z : 0;
                        grabbedBlock.body.position.set(pos3D.x, pos3D.y, targetZ);
                        grabbedBlock.body.velocity.set(0, 0, 0);
                        grabbedBlock.body.angularVelocity.set(0, 0, 0);

                        grabbedBlock.mesh.position.copy(grabbedBlock.body.position);
                        grabbedBlock.body.quaternion.set(0, 0, 0, 1);
                        grabbedBlock.mesh.quaternion.copy(grabbedBlock.body.quaternion);

                        grabbedBlock.velocityY = 0;
                        grabbedBlock.mesh.material.color.setHex(0xff0000);
                    } else if (!isStillHolding) {
                        grabbedBlock.body.type = CANNON.Body.DYNAMIC;
                        grabbedBlock.body.velocity.set(0, 0, 0);
                        grabbedBlock.body.angularVelocity.set(0, 0, 0);
                        grabbedBlock.body.wakeUp();

                        // Cek apakah posisi berubah signifikan setelah digerakkan
                        if (grabbedBlock.startPosition) {
                            const dx = grabbedBlock.body.position.x - grabbedBlock.startPosition.x;
                            const dy = grabbedBlock.body.position.y - grabbedBlock.startPosition.y;
                            const distMoved = Math.sqrt(dx * dx + dy * dy);

                            if (distMoved > 0.05) { // Hanya rekam jika ada pergeseran nyata
                                recordAction({
                                    type: 'move',
                                    blockObj: grabbedBlock,
                                    oldPos: grabbedBlock.startPosition,
                                    newPos: {
                                        x: grabbedBlock.body.position.x,
                                        y: grabbedBlock.body.position.y,
                                        z: grabbedBlock.body.position.z
                                    },
                                    oldRot: grabbedBlock.startQuaternion,
                                    newRot: {
                                        x: grabbedBlock.body.quaternion.x,
                                        y: grabbedBlock.body.quaternion.y,
                                        z: grabbedBlock.body.quaternion.z,
                                        w: grabbedBlock.body.quaternion.w
                                    }
                                });
                            }
                            grabbedBlock.startPosition = null;
                            grabbedBlock.startQuaternion = null;
                        }

                        grabbedBlock.isGrabbed = false;
                        grabbedBlock.mesh.material.color.setHex(grabbedBlock.baseColor);
                        grabbedBlock = null;
                    }
                } else if (!isScalingNow && isAnyPinching && closestBlock && btnCooldown < 20) {
                    // Cek jika ada warna aktif untuk mewarnai material yang pertama di cubit
                    if (activePaintColor !== null) {
                        const oldColor = closestBlock.baseColor;
                        const newColor = activePaintColor;

                        recordAction({
                            type: 'color_multi',
                            changes: [{
                                blockObj: closestBlock,
                                oldColor: oldColor,
                                newColor: newColor
                            }]
                        });

                        closestBlock.baseColor = newColor;
                        closestBlock.mesh.material.color.setHex(newColor);

                        // Reset warna aktif & UI feedback
                        activePaintColor = null;
                        if (btnColorPicker) {
                            btnColorPicker.style.background = '';
                            btnColorPicker.style.color = '';
                        }
                        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                        if (colorPalette) colorPalette.classList.add('hidden');

                        updateStatus('Warna balok berhasil diubah.');
                        btnCooldown = 20;
                    }

                    grabbedBlock = closestBlock;
                    grabbedBlock.isGrabbed = true;
                    grabbedBlock.body.wakeUp(); // Bangunkan bodi fisik jika sebelumnya sedang tidur (beku)
                    grabbedBlock.velocityY = 0;

                    // Simpan posisi & rotasi sebelum digenggam/digerakkan
                    grabbedBlock.startPosition = {
                        x: grabbedBlock.body.position.x,
                        y: grabbedBlock.body.position.y,
                        z: grabbedBlock.body.position.z
                    };
                    grabbedBlock.startQuaternion = {
                        x: grabbedBlock.body.quaternion.x,
                        y: grabbedBlock.body.quaternion.y,
                        z: grabbedBlock.body.quaternion.z,
                        w: grabbedBlock.body.quaternion.w
                    };

                    grabbedBlock.body.type = CANNON.Body.KINEMATIC;
                    grabbedBlock.body.velocity.set(0, 0, 0);
                    grabbedBlock.body.angularVelocity.set(0, 0, 0);
                    grabbedBlock.mesh.material.color.setHex(0xff0000);
                }
            }
        }

        // Kembalikan warna balok lain ke warna aslinya jika tidak sedang digenggam
        for (const block of blocks) {
            if (!block.isGrabbed && (!grabbedBlock || grabbedBlock !== block || !isScaling)) {
                block.mesh.material.color.setHex(block.baseColor);
            }
        }

    } else {
        if (isScaling && grabbedBlock) {
            const finalScale = grabbedBlock.mesh.scale.x;
            if (Math.abs(finalScale - initialBalokScale) > 0.01) {
                recordAction({
                    type: 'scale',
                    blockObj: grabbedBlock,
                    oldScale: initialBalokScale,
                    newScale: finalScale
                });
            }
        }
        isScaling = false;
        if (grabbedBlock) {
            grabbedBlock.body.type = CANNON.Body.DYNAMIC;
            grabbedBlock.body.velocity.set(0, 0, 0);
            grabbedBlock.body.angularVelocity.set(0, 0, 0);
            grabbedBlock.body.wakeUp(); // Bangunkan bodi agar gravitasi langsung bekerja saat dilepas

            // Cek apakah posisi berubah signifikan setelah digerakkan
            if (grabbedBlock.startPosition) {
                const dx = grabbedBlock.body.position.x - grabbedBlock.startPosition.x;
                const dy = grabbedBlock.body.position.y - grabbedBlock.startPosition.y;
                const distMoved = Math.sqrt(dx * dx + dy * dy);

                if (distMoved > 0.05) { // Hanya rekam jika ada pergeseran nyata
                    recordAction({
                        type: 'move',
                        blockObj: grabbedBlock,
                        oldPos: grabbedBlock.startPosition,
                        newPos: {
                            x: grabbedBlock.body.position.x,
                            y: grabbedBlock.body.position.y,
                            z: grabbedBlock.body.position.z
                        },
                        oldRot: grabbedBlock.startQuaternion,
                        newRot: {
                            x: grabbedBlock.body.quaternion.x,
                            y: grabbedBlock.body.quaternion.y,
                            z: grabbedBlock.body.quaternion.z,
                            w: grabbedBlock.body.quaternion.w
                        }
                    });
                }
                grabbedBlock.startPosition = null;
                grabbedBlock.startQuaternion = null;
            }

            grabbedBlock.isGrabbed = false;
            grabbedBlock.mesh.material.color.setHex(grabbedBlock.baseColor);
            grabbedBlock = null;
        }
    }
});

// Helper function to project 3D world coordinates to 2D screen coordinates
function toScreenPosition(obj, camera) {
    const vector = new THREE.Vector3();
    obj.updateMatrixWorld();
    vector.setFromMatrixPosition(obj.matrixWorld);
    vector.project(camera);

    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (vector.y * -0.5 + 0.5) * window.innerHeight;

    return { x, y };
}

// Function to update, position and show/hide the scale badge
const scaleBadge = document.getElementById('scale-badge');
function updateScaleBadge() {
    if (!scaleBadge) return;

    if (isScaling && grabbedBlock) {
        // Project grabbed block position to screen
        const screenPos = toScreenPosition(grabbedBlock.mesh, camera);
        scaleBadge.style.left = `${screenPos.x}px`;
        scaleBadge.style.top = `${screenPos.y}px`;

        // Scale percentage based on initial scale of 0.5 representing 100%
        const currentScale = grabbedBlock.mesh.scale.x;
        const percent = Math.round((currentScale / 0.5) * 100);

        // Calculate bounding box dimensions
        const box = new THREE.Box3().setFromObject(grabbedBlock.mesh);
        const size = new THREE.Vector3();
        box.getSize(size);

        let sizeText = '';
        if (grabbedBlock.shape === 'cube') {
            sizeText = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
        } else if (grabbedBlock.shape === 'plank') {
            sizeText = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
        } else if (grabbedBlock.shape === 'tri' || grabbedBlock.shape === 'pyramid') {
            sizeText = `Ø ${size.x.toFixed(2)} × T ${size.y.toFixed(2)}`;
        } else if (grabbedBlock.shape === 'cylinder') {
            sizeText = `Ø ${size.x.toFixed(2)} × T ${size.y.toFixed(2)}`;
        } else {
            sizeText = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
        }

        const valueEl = scaleBadge.querySelector('.scale-value');
        const dimsEl = scaleBadge.querySelector('.scale-dims');
        if (valueEl) valueEl.textContent = `${percent}%`;
        if (dimsEl) dimsEl.textContent = sizeText;

        if (scaleBadge.classList.contains('hidden')) {
            scaleBadge.classList.remove('hidden');
            // Force reflow
            scaleBadge.offsetHeight;
            scaleBadge.classList.add('visible');
        }
    } else {
        if (!scaleBadge.classList.contains('hidden')) {
            scaleBadge.classList.remove('visible');
            if (scaleBadge.dataset.hideTimeout) {
                clearTimeout(parseInt(scaleBadge.dataset.hideTimeout));
            }
            const timeoutId = setTimeout(() => {
                if (!scaleBadge.classList.contains('visible')) {
                    scaleBadge.classList.add('hidden');
                }
            }, 150);
            scaleBadge.dataset.hideTimeout = timeoutId;
        }
    }
}

// ==========================================
// 5. ANIMASI & FISIKA GRAVITASI
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    // Majukan simulasi fisika Cannon.js
    world.step(1 / 60);


    // Animasi denyut & rotasi reticle penanda dataran AR
    if (arReticle && arReticle.visible) {
        arReticle.material.opacity = 0.65 + Math.sin(Date.now() * 0.006) * 0.25;
        arReticle.rotation.z += 0.01;
    }

    // Update floating size info
    updateScaleBadge();

    // Periksa kondisi kemenangan permainan jika mode game aktif
    checkGameWinCondition();

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];

        if (currentFacingMode === 'user') {
            // Batasi pergerakan di sumbu Z agar tetap pada plane 2D (Z = 0) khusus mode selfie
            block.body.position.z = 0;
            block.body.velocity.z = 0;
            block.body.angularVelocity.x = 0;
            block.body.angularVelocity.y = 0;

            // Kunci rotasi agar hanya berputar di sumbu Z (tidak berputar ke depan/belakang)
            block.body.quaternion.x = 0;
            block.body.quaternion.y = 0;
            const len = Math.sqrt(block.body.quaternion.z * block.body.quaternion.z + block.body.quaternion.w * block.body.quaternion.w);
            if (len > 0) {
                block.body.quaternion.z /= len;
                block.body.quaternion.w /= len;
            }
        }

        if (!block.isGrabbed) {
            block.mesh.position.copy(block.body.position);
            block.mesh.quaternion.copy(block.body.quaternion);
        } else {
            // Efek berputar sedikit saat digenggam
            block.mesh.rotation.x += 0.02;
            block.mesh.rotation.y += 0.02;
            block.body.quaternion.copy(block.mesh.quaternion);
        }

        // Bersihkan balok jika terjatuh ke luar batas visual
        if (block.body.position.y < -15) {
            cleanStacksOfBlock(block);
            scene.remove(block.mesh);
            try { block.mesh.geometry.dispose(); } catch (e) { }
            try { block.mesh.material.dispose(); } catch (e) { }
            try { world.remove(block.body); } catch (e) { }
            blocks.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

// Jalankan animasi secara terus-menerus
animate();

// =====================
// UI INTERACTIONS
// =====================
// Toggle antara Home dan Builder
const screenHome = document.getElementById('screen-home');
const screenBuilder = document.getElementById('screen-builder');
const navHome = document.getElementById('nav-home');
const navBuilder = document.getElementById('nav-builder');
const navHome2 = document.getElementById('nav-home-2');
const navBuilder2 = document.getElementById('nav-builder-2');

function showScreen(name) {
    if (name === 'home') {
        screenHome.classList.add('active');
        screenBuilder.classList.remove('active');
    } else {
        screenHome.classList.remove('active');
        screenBuilder.classList.add('active');
    }
}

if (navHome) navHome.addEventListener('click', () => {
    exitLevel();
});
if (navBuilder) navBuilder.addEventListener('click', () => {
    isGameMode = false;
    clearLevel();
    const hud = document.getElementById('game-hud');
    if (hud) hud.classList.add('hidden');
    showScreen('builder');
});
if (navHome2) navHome2.addEventListener('click', () => {
    exitLevel();
});
if (navBuilder2) navBuilder2.addEventListener('click', () => {
    isGameMode = false;
    clearLevel();
    const hud = document.getElementById('game-hud');
    if (hud) hud.classList.add('hidden');
    showScreen('builder');
});

// Carousel: highlight selection + spawn shape
const carousel = document.getElementById('carousel');
const carouselWrapper = document.getElementById('carousel-wrapper');
let selectedBlock = null;
if (carousel) {
    carousel.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (selectedBlock) selectedBlock.classList.remove('selected');
        selectedBlock = btn;
        selectedBlock.classList.add('selected');
        console.log('Pilih block:', btn.dataset.shape);
        const shape = btn.dataset.shape || 'cube';
        // warna dari kelas
        let color = 0x2B9CFF;
        if (btn.classList.contains('yellow')) color = 0xFFD24D;
        if (btn.classList.contains('green')) color = 0x39C07A;
        if (btn.classList.contains('red')) color = 0xFF6B6B;
        if (btn.classList.contains('orange')) color = 0xFF9D00;
        if (btn.classList.contains('purple')) color = 0x9b59b6;
        createOrUpdateBlock(shape, color);
    });
}

// --- SCROLL BUTTONS FOR CAROUSEL ---
const btnScrollUp = document.getElementById('btn-scroll-up');
const btnScrollDown = document.getElementById('btn-scroll-down');

let scrollInterval = null;
function startScrolling(direction) {
    if (scrollInterval) clearInterval(scrollInterval);
    // Scroll immediately
    carouselWrapper.scrollBy({ top: direction * 10, behavior: 'auto' });
    // Scroll continuously
    scrollInterval = setInterval(() => {
        carouselWrapper.scrollBy({ top: direction * 6, behavior: 'auto' });
    }, 25);
}

function stopScrolling() {
    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }
}

if (btnScrollUp && carouselWrapper) {
    btnScrollUp.addEventListener('mousedown', () => startScrolling(-1));
    btnScrollUp.addEventListener('mouseup', stopScrolling);
    btnScrollUp.addEventListener('mouseleave', stopScrolling);

    btnScrollUp.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startScrolling(-1);
    }, { passive: false });
    btnScrollUp.addEventListener('touchend', stopScrolling);
    btnScrollUp.addEventListener('touchcancel', stopScrolling);

    // Fallback click
    btnScrollUp.addEventListener('click', (e) => {
        if (!scrollInterval) {
            carouselWrapper.scrollBy({ top: -150, behavior: 'smooth' });
        }
    });
}

if (btnScrollDown && carouselWrapper) {
    btnScrollDown.addEventListener('mousedown', () => startScrolling(1));
    btnScrollDown.addEventListener('mouseup', stopScrolling);
    btnScrollDown.addEventListener('mouseleave', stopScrolling);

    btnScrollDown.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startScrolling(1);
    }, { passive: false });
    btnScrollDown.addEventListener('touchend', stopScrolling);
    btnScrollDown.addEventListener('touchcancel', stopScrolling);

    // Fallback click
    btnScrollDown.addEventListener('click', (e) => {
        if (!scrollInterval) {
            carouselWrapper.scrollBy({ top: 150, behavior: 'smooth' });
        }
    });
}

// Kamera (efek umpan balik singkat + Toggle On/Off)
if (cameraBtn) cameraBtn.addEventListener('click', () => {
    toggleCamera();
    // efek visual singkat
    cameraBtn.style.transform = 'scale(0.96)';
    setTimeout(() => cameraBtn.style.transform = '', 150);
});

// Tombol Flip Kamera (Depan / Belakang)
const btnFlipCamera = document.getElementById('btn-flip-camera');
if (btnFlipCamera) {
    btnFlipCamera.addEventListener('click', () => {
        flipCamera();
        btnFlipCamera.style.transform = 'scale(0.9)';
        setTimeout(() => btnFlipCamera.style.transform = '', 150);
    });
}

// Tombol Hapus (Delete Mode)
const btnDelete = document.getElementById('btn-delete');
if (btnDelete) {
    btnDelete.addEventListener('click', () => {
        deleteMode = !deleteMode;
        if (deleteMode) {
            btnDelete.classList.add('active');
            updateStatus('Mode Hapus Aktif. Cubit balok untuk menghapusnya.');
        } else {
            btnDelete.classList.remove('active');
            updateStatus('Mode Hapus Nonaktif.');
        }
    });
}

// Create or update the main block object according to selection
function createOrUpdateBlock(shape, colorHex) {
    if (currentFacingMode === 'environment' && arReticle && arReticle.visible) {
        // Mode AR: Jatuhkan balok TEPAT di tengah lingkaran penanda (arReticle)
        const dropX = arReticle.position.x;
        const dropZ = arReticle.position.z;
        const dropY = arReticle.position.y + 4; // Dari atas lingkaran
        spawnBlock(shape, colorHex, dropX, dropY, dropZ);
        updateStatus('Balok dijatuhkan ke dalam lingkaran penanda AR 🎯');
    } else {
        // Mode Selfie / Studio biasa: Posisi acak X
        const randomX = (Math.random() - 0.5) * 4;
        spawnBlock(shape, colorHex, randomX, 3, 0);
    }
}

// --- LOGIKA EVENT LISTENERS TOMBOL BARU ---
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnColorPicker = document.getElementById('btn-color-picker');
const colorPalette = document.getElementById('color-palette');

if (btnUndo) {
    btnUndo.addEventListener('click', () => {
        executeUndo();
        // Efek feedback visual
        btnUndo.style.transform = 'scale(0.9)';
        setTimeout(() => btnUndo.style.transform = '', 150);
    });
}

if (btnRedo) {
    btnRedo.addEventListener('click', () => {
        executeRedo();
        // Efek feedback visual
        btnRedo.style.transform = 'scale(0.9)';
        setTimeout(() => btnRedo.style.transform = '', 150);
    });
}

if (btnColorPicker && colorPalette) {
    btnColorPicker.addEventListener('click', () => {
        colorPalette.classList.toggle('hidden');
    });

    colorPalette.addEventListener('click', (e) => {
        const dot = e.target.closest('.color-dot');
        if (!dot) return;

        const colorHex = parseInt(dot.dataset.color, 16);
        activePaintColor = colorHex;

        // Beri visual feedback pada dot warna terpilih
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');

        // Ubah warna latar belakang tombol 🎨 untuk indikasi warna aktif
        const dotStyle = window.getComputedStyle(dot);
        btnColorPicker.style.background = dotStyle.backgroundColor;
        btnColorPicker.style.color = '#fff'; // Kontras teks/emoji

        updateStatus('Warna aktif dipilih. Cubit balok untuk mewarnai!');
        colorPalette.classList.add('hidden'); // Sembunyikan palette
    });
}

function createBlueprintGeometry(shape) {
    let geo;
    switch (shape) {
        case 'cube': geo = new THREE.BoxGeometry(2, 2, 2); break;
        case 'plank': geo = new THREE.BoxGeometry(4, 1, 2); break;
        case 'tri': geo = new THREE.ConeGeometry(1.6, 2.4, 3); break;
        case 'pyramid': geo = new THREE.ConeGeometry(1.6, 2.4, 4); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(0.8, 0.8, 2.4, 16); break;
        case 'halfsphere': geo = new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); break;
        case 'arch': {
            const archShape = new THREE.Shape();
            archShape.moveTo(-1.8, -1.4);
            archShape.lineTo(-1.8, 1.4);
            archShape.lineTo(1.8, 1.4);
            archShape.lineTo(1.8, -1.4);
            archShape.lineTo(0.9, -1.4);
            archShape.absarc(0, -1.4, 0.9, 0, Math.PI, false);
            archShape.lineTo(-0.9, -1.4);
            const extrudeSettings = { depth: 1.6, bevelEnabled: false };
            geo = new THREE.ExtrudeGeometry(archShape, extrudeSettings);
            geo.translate(0, 0, -0.8);
            break;
        }
        case 'pent': geo = new THREE.DodecahedronGeometry(1.6); break;
        default: geo = new THREE.BoxGeometry(2, 2, 2);
    }
    return geo;
}

function startLevel(levelKey) {
    clearLevel();
    isGameMode = true;
    currentGameLevel = levelKey;
    gameWinChecked = false;

    // Tampilkan HUD
    const hud = document.getElementById('game-hud');
    const hudName = document.getElementById('hud-level-name');
    if (hud && hudName) {
        hud.classList.remove('hidden');
        hudName.textContent = blueprintsData[levelKey].name;
    }

    // Buat ghost meshes
    const items = blueprintsData[levelKey].items;
    items.forEach((item) => {
        const geo = createBlueprintGeometry(item.shape);

        // Material blueprint: soft glowing neon blue wireframe
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.45
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(item.scale, item.scale, item.scale);
        mesh.position.set(item.pos.x, item.pos.y, item.pos.z);

        // Beberapa rotasi geometri default agar sesuai visual
        if (item.shape === 'tri' || item.shape === 'pyramid') {
            mesh.rotation.y = Math.PI / 4;
        }

        scene.add(mesh);

        blueprintObjects.push({
            mesh: mesh,
            shape: item.shape,
            pos: item.pos,
            scale: item.scale,
            color: item.color,
            matched: false
        });
    });

    updateStatus('Tantangan dimulai. Susun balok sesuai hologram biru!');
}

function clearLevel() {
    gameWinChecked = false;

    // Hapus ghost meshes dari scene
    blueprintObjects.forEach(obj => {
        scene.remove(obj.mesh);
        try { obj.mesh.geometry.dispose(); } catch (e) { }
        try { obj.mesh.material.dispose(); } catch (e) { }
    });
    blueprintObjects = [];

    // Hapus semua block pemain saat ini
    const blocksCopy = [...blocks];
    blocksCopy.forEach(b => removeBlockFromSimulation(b));

    // Sembunyikan sukses modal jika terbuka
    const successModal = document.getElementById('success-modal');
    if (successModal) successModal.classList.add('hidden');
}

function exitLevel() {
    clearLevel();
    isGameMode = false;
    currentGameLevel = null;

    const hud = document.getElementById('game-hud');
    if (hud) hud.classList.add('hidden');

    const selector = document.getElementById('level-selector-overlay');
    if (selector) selector.classList.add('hidden');

    showScreen('home');
}

function checkGameWinCondition() {
    if (!isGameMode || blueprintObjects.length === 0 || gameWinChecked) return;

    // Reset status match blueprint
    blueprintObjects.forEach(bp => {
        bp.matched = false;
        bp.mesh.material.color.setHex(0x00ffff); // Reset ke biru neon
        bp.mesh.material.opacity = 0.45;
    });

    let allMatched = true;

    // Cari balok pemain yang cocok untuk setiap item blueprint
    blueprintObjects.forEach(bp => {
        let foundMatch = false;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];

            // Cek tipe bentuk
            if (block.shape !== bp.shape) continue;

            // Hitung jarak 3D
            const dist = block.mesh.position.distanceTo(new THREE.Vector3(bp.pos.x, bp.pos.y, bp.pos.z));

            // Jarak < 0.65 unit dianggap pas
            if (dist < 0.65) {
                foundMatch = true;
                break;
            }
        }

        if (foundMatch) {
            bp.matched = true;
            bp.mesh.material.color.setHex(0x22c55e); // Hijau sukses
            bp.mesh.material.opacity = 0.65;
        } else {
            allMatched = false;
        }
    });

    if (allMatched && blocks.length > 0) {
        gameWinChecked = true;
        // Tampilkan modal kemenangan
        const successModal = document.getElementById('success-modal');
        if (successModal) {
            successModal.classList.remove('hidden');
            updateStatus('Selamat! Anda berhasil menyusun menara dengan sempurna!');
        }
    }
}

// --- INTEGRASI NAVIGASI HOME & LEVEL SELECTOR ---
const btnPlaySusun = document.querySelector('.big-btn.green');
const btnFreeBuild = document.querySelector('.big-btn.yellow');
const levelSelectorOverlay = document.getElementById('level-selector-overlay');
const btnCloseLevelSelector = document.getElementById('btn-close-level-selector');

if (btnFreeBuild) {
    btnFreeBuild.addEventListener('click', () => {
        isGameMode = false;
        clearLevel();
        document.getElementById('game-hud').classList.add('hidden');
        showScreen('builder');
        updateStatus('Mode Bebas. Silakan bangun sesuka hati Anda.');
    });
}

if (btnPlaySusun) {
    btnPlaySusun.addEventListener('click', () => {
        showScreen('builder');
        if (levelSelectorOverlay) {
            levelSelectorOverlay.classList.remove('hidden');
        }
    });
}

if (btnCloseLevelSelector) {
    btnCloseLevelSelector.addEventListener('click', () => {
        if (levelSelectorOverlay) {
            levelSelectorOverlay.classList.add('hidden');
        }
        showScreen('home');
    });
}

// Event listener untuk tombol-tombol level
document.querySelectorAll('.lvl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const levelKey = btn.dataset.level;
        if (!levelKey) return;

        if (levelSelectorOverlay) {
            levelSelectorOverlay.classList.add('hidden');
        }
        startLevel(levelKey);
    });
});

// Event listener HUD & Win Modal
const btnResetLevel = document.getElementById('btn-reset-level');
const btnExitLevel = document.getElementById('btn-exit-level');
const btnSuccessLevels = document.getElementById('btn-success-levels');
const btnSuccessHome = document.getElementById('btn-success-home');

if (btnResetLevel) {
    btnResetLevel.addEventListener('click', () => {
        if (currentGameLevel) startLevel(currentGameLevel);
    });
}

if (btnExitLevel) {
    btnExitLevel.addEventListener('click', () => {
        exitLevel();
    });
}

if (btnSuccessLevels) {
    btnSuccessLevels.addEventListener('click', () => {
        const successModal = document.getElementById('success-modal');
        if (successModal) successModal.classList.add('hidden');
        clearLevel();
        if (levelSelectorOverlay) {
            levelSelectorOverlay.classList.remove('hidden');
        }
    });
}

if (btnSuccessHome) {
    btnSuccessHome.addEventListener('click', () => {
        const successModal = document.getElementById('success-modal');
        if (successModal) successModal.classList.add('hidden');
        exitLevel();
    });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    trackingCanvas.width = window.innerWidth;
    trackingCanvas.height = window.innerHeight;
});

// ==========================================
// 6. PENJANGKARAN OBJEK MEJA REALISTIS & KONTROL KAMERA 360° (AR WORLD ANCHOR)
// ==========================================
let arAnchorOrientation = null;
const AR_CAMERA_DISTANCE = 8.0;
let gyroSmooth = { theta: 0, phi: Math.PI / 3 }; // Smoothed gyro values
let gyroPermissionRequested = false;

function resetARWorldAnchor() {
    arAnchorOrientation = null;
    gyroSmooth = { theta: 0, phi: Math.PI / 3 };
    arOrbitTheta = 0;
    arOrbitPhi = Math.PI / 3;
    gyroActive = false;
    camera.position.set(0, 1.5, AR_CAMERA_DISTANCE);
    camera.lookAt(0, floorY + 1, 0);
}

// Request DeviceOrientation permission (required on iOS 13+)
async function requestGyroPermission() {
    if (gyroPermissionRequested) return;
    gyroPermissionRequested = true;

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                updateStatus('Izin sensor gyroscope diberikan ✅');
            } else {
                updateStatus('Izin gyroscope ditolak. Gunakan geser layar untuk orbit manual.', true);
            }
        } catch (err) {
            console.error('Gyro permission error:', err);
        }
    }
}

// Touch/Mouse orbit state (declared here for use in gyro handler below)
let isOrbitingAR = false;
let prevTouchX = 0;
let prevTouchY = 0;
let arOrbitTheta = 0; // Horizontal orbit angle (managed by touch/mouse/gyro)
let arOrbitPhi = Math.PI / 3; // Vertical orbit angle
let gyroActive = false; // Track if gyro data is actually being received

// Sensor Gyroscope & Motion HP: Objek 3D Tetap Terkunci di Meja, Kamera Bergerak Sesuai Gerakan HP Physical
if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', (e) => {
        if (currentFacingMode !== 'environment' || isOrbitingAR) return;

        const alpha = e.alpha; // Yaw (0 hingga 360 deg)
        const beta = e.beta;   // Pitch (-180 hingga 180 deg)
        const gamma = e.gamma; // Roll (-90 hingga 90 deg)

        if (alpha === null || beta === null || gamma === null) return;

        // Mark gyro as active on first valid data
        if (!gyroActive) {
            gyroActive = true;
            updateStatus('Gyroscope aktif ✅ Miringkan/putar HP untuk melihat dari sudut berbeda.');
        }

        // Catat orientasi HP pertama kali saat AR diaktifkan sebagai titik acuan
        if (!arAnchorOrientation) {
            arAnchorOrientation = { alpha, beta, gamma };
        }

        // Hitung delta rotasi relatif terhadap posisi awal
        let dAlpha = alpha - arAnchorOrientation.alpha;
        // Handle wrap-around (0-360 boundary)
        if (dAlpha > 180) dAlpha -= 360;
        if (dAlpha < -180) dAlpha += 360;
        const dBeta = beta - arAnchorOrientation.beta;

        // Convert to radians and apply to orbit angles
        const targetTheta = THREE.MathUtils.degToRad(-dAlpha); // Negative: phone right → camera orbits right → objects appear to go left
        let targetPhi = (Math.PI / 3) + THREE.MathUtils.degToRad(dBeta) * 0.5;
        targetPhi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, targetPhi));

        // Smooth interpolation
        arOrbitTheta += (targetTheta - arOrbitTheta) * 0.2;
        arOrbitPhi += (targetPhi - arOrbitPhi) * 0.2;

        // Apply orbit
        applyAROrbit();
    }, true);
}

// Central function to position camera in orbit around objects
function applyAROrbit() {
    const anchor = new THREE.Vector3(0, floorY + 1, 0);
    camera.position.x = anchor.x + AR_CAMERA_DISTANCE * Math.sin(arOrbitPhi) * Math.sin(arOrbitTheta);
    camera.position.y = anchor.y + AR_CAMERA_DISTANCE * Math.cos(arOrbitPhi);
    camera.position.z = anchor.z + AR_CAMERA_DISTANCE * Math.sin(arOrbitPhi) * Math.cos(arOrbitTheta);
    camera.lookAt(anchor);
}

// Generic orbit function used by both touch and mouse
function handleOrbitDelta(deltaX, deltaY) {
    arOrbitTheta -= deltaX * 0.008;
    arOrbitPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, arOrbitPhi - deltaY * 0.008));
    applyAROrbit();
}

// ---- TOUCH ORBIT (Mobile) ----
window.addEventListener('touchstart', (e) => {
    if (currentFacingMode === 'environment' && e.touches.length === 1) {
        const target = e.target;
        if (!target.closest('button') && !target.closest('.right-controls') && !target.closest('.bottom-fab') && !target.closest('.level-overlay')) {
            isOrbitingAR = true;
            prevTouchX = e.touches[0].clientX;
            prevTouchY = e.touches[0].clientY;
            // Reset gyro anchor so gyro doesn't fight with touch orbit
            arAnchorOrientation = null;
        }
    }
});

window.addEventListener('touchmove', (e) => {
    if (isOrbitingAR && currentFacingMode === 'environment' && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - prevTouchX;
        const deltaY = e.touches[0].clientY - prevTouchY;
        prevTouchX = e.touches[0].clientX;
        prevTouchY = e.touches[0].clientY;
        handleOrbitDelta(deltaX, deltaY);
    }
});

window.addEventListener('touchend', () => { isOrbitingAR = false; });

// ---- MOUSE ORBIT (Desktop) ----
let isMouseOrbitingAR = false;
let prevMouseX = 0;
let prevMouseY = 0;

window.addEventListener('mousedown', (e) => {
    if (currentFacingMode === 'environment' && e.button === 0) {
        const target = e.target;
        if (!target.closest('button') && !target.closest('.right-controls') && !target.closest('.bottom-fab') && !target.closest('.level-overlay') && !target.closest('nav') && !target.closest('.color-picker-container')) {
            isMouseOrbitingAR = true;
            isOrbitingAR = true; // Block gyro during mouse orbit
            prevMouseX = e.clientX;
            prevMouseY = e.clientY;
            e.preventDefault();
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (isMouseOrbitingAR && currentFacingMode === 'environment') {
        const deltaX = e.clientX - prevMouseX;
        const deltaY = e.clientY - prevMouseY;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        handleOrbitDelta(deltaX, deltaY);
    }
});

window.addEventListener('mouseup', () => {
    isMouseOrbitingAR = false;
    isOrbitingAR = false;
});

// ==========================================
// 7. WEBXR NATIVE AR 6DoF (MARKERLESS AR SEJATI)
// ==========================================
// Catatan: AR markerless sejati (objek 100% terkunci di meja saat HP digeser)
// HANYA bisa dicapai melalui WebXR AR (Chrome Android + ARCore).
// Tanpa WebXR, browser web tidak dapat mendeteksi pergeseran posisi HP (translasi).
// Gyroscope hanya memberikan rotasi (pitch/yaw/roll), bukan posisi X/Y/Z.
// Oleh karena itu, mode non-WebXR menggunakan:
//   - Gyroscope untuk rotasi kamera mengikuti kemiringan HP
//   - Touch orbit manual untuk melihat objek dari sudut berbeda

const btnWebXRAR = document.getElementById('btn-webxr-ar');
let xrSession = null;
let xrHitTestSource = null;

// Deteksi ketersediaan WebXR AR
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        if (supported && btnWebXRAR) {
            btnWebXRAR.classList.remove('hidden');
            console.log('WebXR AR didukung! Tombol 👓 ditampilkan.');
        }
    }).catch(console.error);
}

// Handler tombol WebXR AR
if (btnWebXRAR) {
    btnWebXRAR.addEventListener('click', async () => {
        if (!navigator.xr) {
            updateStatus('WebXR tidak didukung di browser ini. Gunakan Chrome di Android.');
            return;
        }

        try {
            // Hentikan kamera MediaPipe terlebih dahulu
            stopCamera();

            const session = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['hit-test', 'local-floor'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.getElementById('screen-builder') }
            });

            xrSession = session;
            renderer.xr.enabled = true;
            renderer.xr.setReferenceSpaceType('local-floor');
            await renderer.xr.setSession(session);

            // Sembunyikan UI yang tidak perlu di mode WebXR
            floor.visible = false;
            arShadowFloor.visible = true;
            arShadowFloor.position.y = 0; // Lantai di level tanah WebXR
            if (arReticle) {
                arReticle.visible = true;
                arReticle.position.y = 0.01;
            }

            // Request hit-test source untuk deteksi permukaan
            const viewerSpace = await session.requestReferenceSpace('viewer');
            const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
            xrHitTestSource = hitTestSource;

            // Override animate loop untuk WebXR
            renderer.setAnimationLoop((timestamp, frame) => {
                if (frame && xrHitTestSource) {
                    const referenceSpace = renderer.xr.getReferenceSpace();
                    const hitTestResults = frame.getHitTestResults(xrHitTestSource);

                    if (hitTestResults.length > 0) {
                        const hit = hitTestResults[0];
                        const pose = hit.getPose(referenceSpace);

                        if (pose && arReticle) {
                            arReticle.visible = true;
                            arReticle.position.set(
                                pose.transform.position.x,
                                pose.transform.position.y,
                                pose.transform.position.z
                            );
                            arReticle.updateMatrixWorld(true);
                        }
                    }
                }

                // Fisika tetap berjalan
                world.step(1 / 60);
                for (let i = blocks.length - 1; i >= 0; i--) {
                    const block = blocks[i];
                    if (!block.isGrabbed) {
                        block.mesh.position.copy(block.body.position);
                        block.mesh.quaternion.copy(block.body.quaternion);
                    }
                }

                renderer.render(scene, camera);
            });

            updateStatus('WebXR AR 6DoF Aktif 👓! Arahkan HP ke meja untuk mendeteksi permukaan. Objek terkunci 100% di dunia nyata!');

            session.addEventListener('end', () => {
                xrSession = null;
                xrHitTestSource = null;
                renderer.xr.enabled = false;
                renderer.setAnimationLoop(null);

                // Kembalikan lantai dan kamera studio
                floor.visible = true;
                arShadowFloor.visible = false;
                if (arReticle) arReticle.visible = false;
                arShadowFloor.position.y = floorY;
                camera.position.set(0, 0, 10);
                camera.lookAt(0, 0, 0);

                // Jalankan kembali animate loop biasa
                animate();

                updateStatus('Sesi WebXR AR berakhir. Kembali ke mode studio.');
            });
        } catch (err) {
            console.error('WebXR AR Session Error:', err);
            updateStatus('Gagal memulai WebXR AR: ' + err.message, true);
        }
    });
}