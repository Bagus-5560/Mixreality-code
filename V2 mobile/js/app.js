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

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 5);
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

// Lantai Virtual (Batas Bawah) — sekarang dinamis
let floorY = -3;
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

// ==========================================
// 1C. SISTEM LANTAI ADAPTIF (DYNAMIC FLOOR)
// ==========================================
let floorAutoTilt = false; // Mode auto tilt (gyroscope)
let targetFloorY = floorY; // Target posisi lantai (untuk smooth interpolation)
let floorTiltDeg = 0; // Kemiringan lantai dalam derajat (0 = datar, 90 = vertikal)
let targetFloorTiltDeg = floorTiltDeg;
let lastTiltBeta = null; // Nilai beta terakhir dari gyroscope
let floorSliderActive = false; // Apakah slider sedang aktif digunakan

// Fungsi utama untuk mengupdate posisi lantai
function updateFloorPosition(newY, newTiltDeg, smooth = true) {
    if (newY !== null) {
        newY = Math.max(-8, Math.min(newY, 5));
        if (smooth) targetFloorY = newY;
        else { targetFloorY = newY; floorY = newY; }
    }
    
    if (newTiltDeg !== null) {
        newTiltDeg = Math.max(0, Math.min(newTiltDeg, 90));
        if (smooth) targetFloorTiltDeg = newTiltDeg;
        else { targetFloorTiltDeg = newTiltDeg; floorTiltDeg = newTiltDeg; }
    }
    
    if (!smooth) applyFloorPosition();
}

function applyFloorPosition() {
    // 1. Update posisi visual lantai (Three.js mesh)
    floor.position.y = floorY;
    
    // Rotasi default lantai adalah -90 derajat (-Math.PI/2). Kita tambah dengan kemiringan.
    const tiltRad = THREE.MathUtils.degToRad(floorTiltDeg);
    floor.rotation.x = -Math.PI / 2 + tiltRad;

    // 2. Update posisi & rotasi fisika lantai (Cannon.js body)
    groundBody.position.set(0, floorY, 0);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2 + tiltRad);

    // 3. Update Gravitasi agar tegak lurus dengan lantai (supaya balok tidak meluncur jatuh)
    const baseGravity = 38;
    // Arah gravitasi baru mengikuti normal lantai yang diputar
    world.gravity.set(0, -baseGravity * Math.cos(tiltRad), -baseGravity * Math.sin(tiltRad));

    // Bangunkan semua block yang sedang tidur agar bereaksi terhadap lantai/gravitasi baru
    for (const block of blocks) {
        if (block.body.sleepState === CANNON.Body.SLEEPING) {
            block.body.wakeUp();
        }
    }

    // Update UI indicator
    updateFloorBadge();
    updateFloorSliderUI();
}

// Smooth interpolation lantai di setiap frame
function smoothFloorUpdate() {
    let changed = false;
    
    if (Math.abs(floorY - targetFloorY) > 0.01) {
        floorY += (targetFloorY - floorY) * 0.08;
        changed = true;
    } else if (floorY !== targetFloorY) {
        floorY = targetFloorY;
        changed = true;
    }
    
    if (Math.abs(floorTiltDeg - targetFloorTiltDeg) > 0.1) {
        floorTiltDeg += (targetFloorTiltDeg - floorTiltDeg) * 0.08;
        changed = true;
    } else if (floorTiltDeg !== targetFloorTiltDeg) {
        floorTiltDeg = targetFloorTiltDeg;
        changed = true;
    }
    
    if (changed) {
        applyFloorPosition();
    }
}

// Update badge UI
function updateFloorBadge() {
    const badgeValue = document.getElementById('floor-badge-value');
    if (badgeValue) {
        badgeValue.textContent = 'Y: ' + floorY.toFixed(1);
    }
}

// Update slider UI
function updateFloorSliderUI() {
    if (floorSliderActive) return; // Jangan update slider saat user sedang drag
    const slider = document.getElementById('floor-slider');
    const sliderValue = document.getElementById('floor-slider-value');
    if (slider) slider.value = floorY.toFixed(1);
    if (sliderValue) sliderValue.textContent = floorY.toFixed(1);
    
    const tiltSlider = document.getElementById('floor-tilt-slider');
    const tiltSliderValue = document.getElementById('floor-tilt-slider-value');
    if (tiltSlider) tiltSlider.value = floorTiltDeg.toFixed(0);
    if (tiltSliderValue) tiltSliderValue.textContent = floorTiltDeg.toFixed(0) + '°';

    // Update active preset
    document.querySelectorAll('.floor-preset').forEach(btn => {
        const presetY = parseFloat(btn.dataset.floorY);
        if (Math.abs(floorY - presetY) < 0.2) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// ==========================================
// GYROSCOPE / DEVICE ORIENTATION (Auto Tilt)
// ==========================================
function handleDeviceOrientation(event) {
    if (!floorAutoTilt) return;

    const beta = event.beta; // Kemiringan depan-belakang: 0 = datar, 90 = tegak
    if (beta === null) return;

    lastTiltBeta = beta;

    // Mapping beta ke sudut tilt:
    // beta ~90° (ponsel tegak, melihat lurus) → floorTilt = 0° (lantai normal)
    // beta ~0° (ponsel datar, melihat meja) → floorTilt = 90° (lantai menghadap kamera)
    
    let mappedTilt = 90 - beta;
    // Clamp antara 0 dan 90 derajat
    mappedTilt = Math.max(0, Math.min(mappedTilt, 90));

    // Biarkan posisi Y tetap (atau atur manual), tilt dikontrol gyroscope
    updateFloorPosition(null, mappedTilt, true);
}

// Request permission untuk DeviceOrientation (diperlukan di iOS 13+)
function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ memerlukan permission request
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
                    updateStatus('Sensor tilt aktif.');
                } else {
                    updateStatus('Izin sensor ditolak. Gunakan slider manual.', true);
                    floorAutoTilt = false;
                    const checkbox = document.getElementById('floor-auto-tilt');
                    if (checkbox) checkbox.checked = false;
                }
            })
            .catch(err => {
                console.error('DeviceOrientation permission error:', err);
                updateStatus('Sensor tilt tidak tersedia.', true);
                floorAutoTilt = false;
                const checkbox = document.getElementById('floor-auto-tilt');
                if (checkbox) checkbox.checked = false;
            });
    } else if ('DeviceOrientationEvent' in window) {
        // Android & browser lain yang tidak perlu permission
        window.addEventListener('deviceorientation', handleDeviceOrientation, true);
        updateStatus('Sensor tilt aktif.');
    } else {
        updateStatus('Sensor tilt tidak didukung di perangkat ini.', true);
        floorAutoTilt = false;
        const checkbox = document.getElementById('floor-auto-tilt');
        if (checkbox) checkbox.checked = false;
    }
}

function stopOrientationListener() {
    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    updateStatus('Sensor tilt dinonaktifkan.');
}

// Array untuk menyimpan semua balok di scene
let blocks = [];
let deleteMode = false;
let grabbedBlock = null;
let activePaintColor = null;

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
    try { world.remove(blockObj.body); } catch (e) {}
    blocks = blocks.filter(b => b !== blockObj);
    if (grabbedBlock === blockObj) grabbedBlock = null;
}

function addBlockToSimulation(blockObj) {
    scene.add(blockObj.mesh);
    try { world.addBody(blockObj.body); } catch (e) {}
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

let showTracking = false;
let cameraActive = false;
let btnCooldown = 0;
let useBackCamera = false; // false = kamera depan (default), true = kamera belakang

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
    if (useBackCamera) {
        // Kamera belakang: tidak perlu mirror
        return { x: (x - 0.5) * 14, y: -(y - 0.5) * 10 };
    } else {
        // Kamera depan: perlu mirror X
        const mirroredX = 1 - x;
        return { x: (mirroredX - 0.5) * 14, y: -(y - 0.5) * 10 };
    }
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

// Fungsi Menyalakan Kamera (Depan atau Belakang)
let cameraAnimFrameId = null;
function startCamera() {
    const cameraLabel = useBackCamera ? 'belakang' : 'depan';
    updateStatus('Meminta akses kamera ' + cameraLabel + '...');

    // Pilih facingMode berdasarkan mode kamera
    const facingMode = useBackCamera ? 'environment' : 'user';
    const constraints = {
        video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 640 },
            height: { ideal: 480 }
        }
    };

    // Toggle CSS class untuk mirror/no-mirror
    if (useBackCamera) {
        videoElement.classList.add('back-camera');
        trackingCanvas.classList.add('back-camera');
    } else {
        videoElement.classList.remove('back-camera');
        trackingCanvas.classList.remove('back-camera');
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
            videoElement.srcObject = stream;
            videoElement.play();

            // Loop pengiriman frame ke MediaPipe Hands
            async function sendFrame() {
                if (!cameraActive) return;
                if (videoElement.readyState >= 2) {
                    await hands.send({ image: videoElement });
                }
                cameraAnimFrameId = requestAnimationFrame(sendFrame);
            }

            videoElement.onloadeddata = () => {
                cameraActive = true;
                showTracking = true;
                virtualBtn.material.color.setHex(0x00ff00);
                if (cameraBtn) cameraBtn.classList.add('active');
                updateStatus('Kamera ' + cameraLabel + ' aktif. Tunjukkan tangan ke kamera.');
                sendFrame();
            };
        })
        .catch((error) => {
            console.error('Gagal mengakses kamera ' + cameraLabel + ':', error);
            updateStatus('Gagal menyalakan kamera ' + cameraLabel + '. Izinkan kamera di browser.', true);
            cameraActive = false;
            if (cameraBtn) cameraBtn.classList.remove('active');
        });
}

// Fungsi Mematikan Kamera
function stopCamera() {
    // Hentikan animation frame loop
    if (cameraAnimFrameId) {
        cancelAnimationFrame(cameraAnimFrameId);
        cameraAnimFrameId = null;
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

// Fungsi Switch Kamera Depan/Belakang
function switchCamera() {
    useBackCamera = !useBackCamera;
    // Update tampilan tombol switch
    const switchBtn = document.getElementById('btn-switch-camera');
    if (switchBtn) {
        switchBtn.textContent = useBackCamera ? '📱' : '🔄';
        switchBtn.title = useBackCamera ? 'Ganti ke Kamera Depan' : 'Ganti ke Kamera Belakang';
    }
    // Restart kamera jika sedang aktif
    if (cameraActive) {
        stopCamera();
        setTimeout(() => startCamera(), 300); // delay sedikit agar stream lama benar-benar berhenti
    }
    const cameraLabel = useBackCamera ? 'belakang' : 'depan';
    updateStatus('Mode kamera: ' + cameraLabel);
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

// Event Listener Tombol Switch Kamera (Depan/Belakang)
const btnSwitchCamera = document.getElementById('btn-switch-camera');
if (btnSwitchCamera) {
    btnSwitchCamera.addEventListener('click', () => {
        switchCamera();
    });
}

// ==========================================
// 4. LOGIKA DETEKSI TANGAN (MediaPipe)
// ==========================================
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

hands.onResults((results) => {
    // 4A. MENGGAMBAR GARIS TRACKING
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
        const isHand1Pinching = pinchDist1 < 0.06;
        const pinchDist2 = hand2 ? getDistance(hand2[4], hand2[8]) : 1;
        const isHand2Pinching = hand2 ? pinchDist2 < 0.06 : false;
        const isAnyPinching = isHand1Pinching || isHand2Pinching;



        const midX1 = (hand1[4].x + hand1[8].x) / 2;
        const midY1 = (hand1[4].y + hand1[8].y) / 2;
        const pos3D = mapTo3DSpace(midX1, midY1);

        // --- PINCH TO CLICK OR HOLD HTML BUTTONS ---
        let clickedHTMLButton = false;
        if (isHand1Pinching) {
            const screenX = useBackCamera ? (midX1 * window.innerWidth) : ((1 - midX1) * window.innerWidth);
            const screenY = midY1 * window.innerHeight;
            const element = document.elementFromPoint(screenX, screenY);
            if (element) {
                const button = element.closest('button');
                if (button) {
                    if (button.classList.contains('scroll-btn')) {
                        // Continuous scrolling during pinch hold (no cooldown needed)
                        const direction = button.id === 'btn-scroll-up' ? -5 : 5;
                        carouselWrapper.scrollBy({ top: direction, behavior: 'auto' });
                        clickedHTMLButton = true;
                    } else if (btnCooldown === 0) {
                        button.click();
                        btnCooldown = 30; // 0.5s cooldown for other buttons
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

                    // Update bentuk fisika
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

            // Cari balok terdekat
            let closestBlock = null;
            let minDistance = Infinity;

            for (const block of blocks) {
                const hitArea = block.mesh.scale.x * 2;
                const distToBlockX = Math.abs(pos3D.x - block.mesh.position.x);
                const distToBlockY = Math.abs(pos3D.y - block.mesh.position.y);
                if (distToBlockX < hitArea && distToBlockY < hitArea) {
                    const dist = Math.sqrt(distToBlockX * distToBlockX + distToBlockY * distToBlockY);
                    if (dist < minDistance) {
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
                // Hanya izinkan seleksi jika tidak ada warna aktif yang siap diwarnai
                if (pinchStart && selectionCooldown === 0 && closestBlock && btnCooldown < 20 && activePaintColor === null) {
                    closestBlock.isSelected = !closestBlock.isSelected;
                    if (closestBlock.isSelected) {
                        closestBlock.mesh.material.emissive = new THREE.Color(0x222222);
                        closestBlock.mesh.material.emissiveIntensity = 0.9;
                    } else {
                        closestBlock.mesh.material.emissive = new THREE.Color(0x000000);
                        closestBlock.mesh.material.emissiveIntensity = 0.0;
                    }
                    selectionCooldown = 30; // small cooldown
                    btnCooldown = 20;
                }
                prevPinch = isHand1Pinching;

                if (grabbedBlock) {
                    if (!isScalingNow && isAnyPinching) {
                        // KINEMATIC agar pergerakan oleh tangan stabil dan presisi
                        grabbedBlock.body.type = CANNON.Body.KINEMATIC;
                        grabbedBlock.body.position.set(pos3D.x, pos3D.y, grabbedBlock.body.position.z);
                        grabbedBlock.body.velocity.set(0, 0, 0);
                        grabbedBlock.body.angularVelocity.set(0, 0, 0);

                        grabbedBlock.mesh.position.copy(grabbedBlock.body.position);
                        grabbedBlock.body.quaternion.set(0, 0, 0, 1); // Tegak lurus saat digenggam
                        grabbedBlock.mesh.quaternion.copy(grabbedBlock.body.quaternion);

                        grabbedBlock.velocityY = 0;
                        grabbedBlock.mesh.material.color.setHex(0xff0000); // Merah saat digenggam
                    } else if (!isAnyPinching) {
                        // Kembalikan ke DYNAMIC agar simulasi gravitasi berjalan normal kembali saat dilepas
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

    // Smooth interpolasi lantai
    smoothFloorUpdate();

    // Update floating size info
    updateScaleBadge();

    // Periksa kondisi kemenangan permainan jika mode game aktif
    checkGameWinCondition();

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];

        // Hapus batasan 2D: Balok dibiarkan bergerak bebas secara 3D di semua sumbu.

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
    // Memunculkan balok baru dengan posisi random di sumbu X agar tidak bertumpuk persis
    const randomX = (Math.random() - 0.5) * 4;
    spawnBlock(shape, colorHex, randomX, 3, 0);
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
        
        // Hitung ulang posisi 3D berdasarkan floorY dan floorTiltDeg (dinamis)
        const baseOffset = item.pos.y - (-3); 
        
        const tiltRad = THREE.MathUtils.degToRad(floorTiltDeg);
        
        // Rotasi posisi (y, z) di sekitar sumbu X pada pivot (0, floorY, 0)
        // Asumsi item.pos.z awalnya 0 untuk blueprints 2D
        const dynamicY = floorY + baseOffset * Math.cos(tiltRad);
        const dynamicZ = item.pos.z + baseOffset * Math.sin(tiltRad);
        
        mesh.position.set(item.pos.x, dynamicY, dynamicZ);
        
        // Rotasi mesh agar miring sejajar dengan lantai
        mesh.rotation.x = tiltRad;
        
        // Beberapa rotasi geometri default agar sesuai visual
        if (item.shape === 'tri' || item.shape === 'pyramid') {
            mesh.rotation.y = Math.PI / 4;
        }
        
        scene.add(mesh);
        
        blueprintObjects.push({
            mesh: mesh,
            shape: item.shape,
            pos: { x: item.pos.x, y: dynamicY, z: dynamicZ }, // Simpan posisi dinamis untuk verifikasi kemenangan
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
        try { obj.mesh.geometry.dispose(); } catch (e) {}
        try { obj.mesh.material.dispose(); } catch (e) {}
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
const btnSuccessRetry = document.getElementById('btn-success-retry');
const btnSuccessLevels = document.getElementById('btn-success-levels');

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

if (btnSuccessRetry) {
    btnSuccessRetry.addEventListener('click', () => {
        document.getElementById('success-modal').classList.add('hidden');
        if (currentGameLevel) startLevel(currentGameLevel);
    });
}

if (btnSuccessLevels) {
    btnSuccessLevels.addEventListener('click', () => {
        document.getElementById('success-modal').classList.add('hidden');
        clearLevel();
        if (levelSelectorOverlay) {
            levelSelectorOverlay.classList.remove('hidden');
        }
    });
}

// ==========================================
// FLOOR CONTROL EVENT LISTENERS
// ==========================================
const btnFloor = document.getElementById('btn-floor');
const floorBadge = document.getElementById('floor-badge');
const floorSliderOverlay = document.getElementById('floor-slider-overlay');
const btnCloseFloorSlider = document.getElementById('btn-close-floor-slider');
const floorSlider = document.getElementById('floor-slider');
const floorAutoCheckbox = document.getElementById('floor-auto-tilt');
const floorPresets = document.querySelectorAll('.floor-preset');

if (btnFloor && floorSliderOverlay) {
    btnFloor.addEventListener('click', () => {
        floorSliderOverlay.classList.remove('hidden');
        btnFloor.classList.add('active');
        floorBadge.classList.remove('hidden');
        updateFloorSliderUI();
    });
}

if (btnCloseFloorSlider && floorSliderOverlay) {
    btnCloseFloorSlider.addEventListener('click', () => {
        floorSliderOverlay.classList.add('hidden');
        btnFloor.classList.remove('active');
        // Sembunyikan badge jika tidak ada blok (badge juga digunakan untuk scale info)
        if (!isScaling) {
            // floorBadge.classList.add('hidden'); // Optional: hide badge when closing slider
        }
    });
}

if (floorSlider) {
    floorSlider.addEventListener('input', (e) => {
        floorSliderActive = true;
        const newY = parseFloat(e.target.value);
        document.getElementById('floor-slider-value').textContent = newY.toFixed(1);
        updateFloorPosition(newY, null, false); // false = apply instantly without lerp
        
        // Nonaktifkan auto-tilt saat user manual adjust
        if (floorAutoTilt) {
            floorAutoTilt = false;
            if (floorAutoCheckbox) floorAutoCheckbox.checked = false;
            stopOrientationListener();
        }
    });
    
    floorSlider.addEventListener('change', () => {
        floorSliderActive = false;
    });
}

const tiltSlider = document.getElementById('floor-tilt-slider');
if (tiltSlider) {
    tiltSlider.addEventListener('input', (e) => {
        floorSliderActive = true;
        const newTilt = parseFloat(e.target.value);
        document.getElementById('floor-tilt-slider-value').textContent = newTilt.toFixed(0) + '°';
        updateFloorPosition(null, newTilt, false);
        
        if (floorAutoTilt) {
            floorAutoTilt = false;
            if (floorAutoCheckbox) floorAutoCheckbox.checked = false;
            stopOrientationListener();
        }
    });
    
    tiltSlider.addEventListener('change', () => {
        floorSliderActive = false;
    });
}

if (floorPresets) {
    floorPresets.forEach(presetBtn => {
        presetBtn.addEventListener('click', () => {
            const presetY = parseFloat(presetBtn.dataset.floorY);
            // Preset kembalikan kemiringan ke 0
            const presetTilt = 0;
            
            // Animasi slider
            if (floorSlider) {
                floorSlider.value = presetY;
                document.getElementById('floor-slider-value').textContent = presetY.toFixed(1);
            }
            if (tiltSlider) {
                tiltSlider.value = presetTilt;
                document.getElementById('floor-tilt-slider-value').textContent = presetTilt.toFixed(0) + '°';
            }
            
            updateFloorPosition(presetY, presetTilt, true); // true = smooth transition
            
            // Nonaktifkan auto-tilt saat user pilih preset
            if (floorAutoTilt) {
                floorAutoTilt = false;
                if (floorAutoCheckbox) floorAutoCheckbox.checked = false;
                stopOrientationListener();
            }
        });
    });
}

if (floorAutoCheckbox) {
    floorAutoCheckbox.addEventListener('change', (e) => {
        floorAutoTilt = e.target.checked;
        if (floorAutoTilt) {
            requestOrientationPermission();
        } else {
            stopOrientationListener();
        }
    });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    trackingCanvas.width = window.innerWidth;
    trackingCanvas.height = window.innerHeight;
});