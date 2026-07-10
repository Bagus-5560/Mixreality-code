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

// Lantai Virtual (Batas Bawah)
const floorY = -3;
const floorGeometry = new THREE.PlaneGeometry(20, 10);
const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x4a4a4a, wireframe: true, transparent: true, opacity: 0.3 });
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
world.solver.iterations = 10;

// Material fisika untuk interaksi (Friction & Restitution)
const groundMaterial = new CANNON.Material("groundMaterial");
const blockMaterial = new CANNON.Material("blockMaterial");

// Kontak antara balok dengan lantai (Friction tinggi)
const groundBlockContact = new CANNON.ContactMaterial(groundMaterial, blockMaterial, {
    friction: 0.9,
    restitution: 0.1
});
world.addContactMaterial(groundBlockContact);

// Kontak sesama balok (Friction maksimal & tanpa pantulan agar ditumpuk stabil)
const blockBlockContact = new CANNON.ContactMaterial(blockMaterial, blockMaterial, {
    friction: 1.0,
    restitution: 0.0
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

// Fungsi Menghapus & Mengupdate Shape Fisika (saat discale)
function updatePhysicsShape(block, scale) {
    // Bersihkan array shape secara langsung karena removeShape mungkin tidak tersedia di versi ini
    block.body.shapes.length = 0;
    block.body.shapeOffsets.length = 0;
    block.body.shapeOrientations.length = 0;

    let physicsShape;

    switch (block.shape) {
        case 'cube':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1 * scale, 1 * scale, 1 * scale));
            break;
        case 'tri':
        case 'pyramid':
            // Menggunakan CANNON.Box untuk cone/pyramid demi kestabilan tabrakan & tumpukan di Cannon.js
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.6 * scale, 1.2 * scale, 1.6 * scale));
            break;
        case 'pent':
            physicsShape = new CANNON.Sphere(1.6 * scale);
            break;
        default:
            physicsShape = new CANNON.Box(new CANNON.Vec3(1 * scale, 1 * scale, 1 * scale));
    }
    block.body.addShape(physicsShape);
    block.body.updateMassProperties();
    block.body.updateBoundingRadius();
}

// Fungsi Menambahkan Balok Baru ke Scene (dengan rigid body fisika)
function spawnBlock(shape, colorHex, x = 0, y = 0, z = 0) {
    let geo;
    switch (shape) {
        case 'cube': geo = new THREE.BoxGeometry(2, 2, 2); break;
        case 'tri': geo = new THREE.ConeGeometry(1.6, 2.4, 3); break; // triangular pyramid
        case 'pyramid': geo = new THREE.ConeGeometry(1.6, 2.4, 4); break; // square-based pyramid-ish
        case 'pent': geo = new THREE.DodecahedronGeometry(1.6); break;
        default: geo = new THREE.BoxGeometry(2, 2, 2);
    }
    const mat = new THREE.MeshPhongMaterial({ color: colorHex || 0x00ff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    // --- FISIKA CANNON.JS ---
    let physicsShape;
    switch (shape) {
        case 'cube':
            physicsShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
            break;
        case 'tri':
        case 'pyramid':
            // Menggunakan CANNON.Box untuk cone/pyramid demi kestabilan tabrakan & tumpukan di Cannon.js
            physicsShape = new CANNON.Box(new CANNON.Vec3(1.6, 1.2, 1.6));
            break;
        case 'pent':
            physicsShape = new CANNON.Sphere(1.6);
            break;
        default:
            physicsShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
    }

    const body = new CANNON.Body({
        mass: 1, // dinamis
        material: blockMaterial
    });
    body.addShape(physicsShape);
    body.position.set(x, y, z);
    world.addBody(body);

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
let cameraUtils;
let currentFacingMode = 'environment'; // 'environment' = kamera belakang, 'user' = kamera depan

const trackingCanvas = document.getElementById('tracking_canvas');
const trackingCtx = trackingCanvas.getContext('2d');
trackingCanvas.width = window.innerWidth;
trackingCanvas.height = window.innerHeight;

const videoElement = document.getElementById('webcam');
const btnTracking = document.getElementById('btn-tracking');
const statusEl = document.getElementById('status');
const cameraBtn = document.getElementById('camera-btn');

// ==========================================
// 3. DEVICE ORIENTATION (AR SENSOR)
// ==========================================
let orientationActive = false;
let deviceAlpha = 0, deviceBeta = 90, deviceGamma = 0;

// Quaternion helpers untuk konversi Device Orientation → Three.js camera
const _zee = new THREE.Vector3(0, 0, 1);
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° di X
const _deviceQuaternion = new THREE.Quaternion();
const _deviceEuler = new THREE.Euler();

// Kalibrasi: simpan orientasi awal HP sebagai titik nol
let _calibrationQuaternion = null;
const _calibrationInverse = new THREE.Quaternion();

// Raycaster untuk konversi koordinat tangan → dunia 3D saat AR mode
const _raycaster = new THREE.Raycaster();
const _arPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // plane z=0
const _intersectPoint = new THREE.Vector3();
const _screenCoord = new THREE.Vector2();

function onDeviceOrientation(event) {
    if (event.alpha === null) return;
    deviceAlpha = event.alpha;
    deviceBeta = event.beta;
    deviceGamma = event.gamma;
}

function startOrientation() {
    _calibrationQuaternion = null; // Reset kalibrasi saat mulai ulang
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ memerlukan izin eksplisit
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    window.addEventListener('deviceorientation', onDeviceOrientation, true);
                    orientationActive = true;
                }
            })
            .catch(err => console.error('Izin orientasi ditolak:', err));
    } else {
        // Android & browser lain — langsung aktif
        window.addEventListener('deviceorientation', onDeviceOrientation, true);
        orientationActive = true;
    }
}

function stopOrientation() {
    window.removeEventListener('deviceorientation', onDeviceOrientation, true);
    orientationActive = false;
    _calibrationQuaternion = null;
    // Reset kamera ke posisi default
    camera.quaternion.set(0, 0, 0, 1);
    camera.position.set(0, 0, 10);
}

// Hitung quaternion orientasi absolut dari sensor HP
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

// Terapkan orientasi device ke kamera Three.js (RELATIF, bukan absolut)
function applyDeviceOrientation() {
    if (!orientationActive) return;

    const currentQuat = _computeDeviceQuaternion();

    // Kalibrasi: simpan orientasi pertama sebagai "titik nol"
    // Saat pertama kali, orientasi HP = default view (melihat objek)
    if (!_calibrationQuaternion) {
        _calibrationQuaternion = currentQuat.clone();
        _calibrationInverse.copy(_calibrationQuaternion).invert();
    }

    // Hitung rotasi RELATIF: perbedaan dari orientasi awal
    // Ini membuat: posisi awal HP = melihat objek, gerakkan HP = parallax AR
    const relativeQuat = _calibrationInverse.clone().multiply(currentQuat);
    camera.quaternion.copy(relativeQuat);
}

// ==========================================
// 3B. FUNGSI BANTUAN MATEMATIKA & KAMERA
// ==========================================
function mapTo3DSpace(x, y) {
    if (orientationActive) {
        // AR MODE: Raycast dari kamera melalui titik layar ke plane z=0
        _screenCoord.set(x * 2 - 1, -(y * 2 - 1));
        _raycaster.setFromCamera(_screenCoord, camera);

        if (_raycaster.ray.intersectPlane(_arPlane, _intersectPoint)) {
            // Batasi agar tidak terlalu jauh (saat kamera mendekati paralel dengan plane)
            const cx = THREE.MathUtils.clamp(_intersectPoint.x, -12, 12);
            const cy = THREE.MathUtils.clamp(_intersectPoint.y, -8, 10);
            return { x: cx, y: cy };
        }
    }

    // FALLBACK / MODE NON-AR (kamera depan)
    const finalX = currentFacingMode === 'user' ? (1 - x) : x;
    return { x: (finalX - 0.5) * 14, y: -(y - 0.5) * 10 };
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
let _animFrameId = null;

async function startCamera() {
    updateStatus('Meminta akses kamera...');

    // Hentikan stream sebelumnya jika ada
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

        // Mirror video hanya untuk kamera depan, kamera belakang tidak mirror
        const mirrorValue = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        videoElement.style.transform = mirrorValue;
        trackingCanvas.style.transform = mirrorValue;

        // Aktifkan Device Orientation untuk kamera belakang (AR mode)
        if (currentFacingMode === 'environment') {
            startOrientation();
        }

        const label = currentFacingMode === 'environment' ? 'belakang (AR)' : 'depan';
        updateStatus('Kamera ' + label + ' aktif. Tunjukkan tangan ke depan kamera.');

        // Mulai loop pengiriman frame ke MediaPipe Hands
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
        console.error('Gagal mengakses kamera:', error);
        updateStatus('Gagal menyalakan kamera. Izinkan kamera di browser.', true);
        cameraActive = false;
        if (cameraBtn) cameraBtn.classList.remove('active');
    }
}

// Fungsi Switch Kamera Depan/Belakang
function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    // Beri sedikit waktu agar kamera sebelumnya benar-benar berhenti
    setTimeout(() => {
        startCamera();
    }, 300);
}

// Fungsi Mematikan Kamera
function stopCamera() {
    cameraActive = false;
    if (_animFrameId) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = null;
    }
    // Matikan Device Orientation (AR sensor)
    if (orientationActive) {
        stopOrientation();
    }
    // Hentikan track video secara manual untuk mematikan lampu indikator kamera
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
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
        const isHand1Pinching = pinchDist1 < 0.12;
        const pinchDist2 = hand2 ? getDistance(hand2[4], hand2[8]) : 1;
        const isHand2Pinching = hand2 ? pinchDist2 < 0.12 : false;
        const isAnyPinching = isHand1Pinching || isHand2Pinching;

        const midX1 = (hand1[4].x + hand1[8].x) / 2;
        const midY1 = (hand1[4].y + hand1[8].y) / 2;
        const pos3D = mapTo3DSpace(midX1, midY1);

        // --- PINCH TO CLICK HTML BUTTONS ---
        let clickedHTMLButton = false;
        if (isHand1Pinching && btnCooldown === 0) {
            const screenX = (currentFacingMode === 'user' ? (1 - midX1) : midX1) * window.innerWidth;
            const screenY = midY1 * window.innerHeight;
            const element = document.elementFromPoint(screenX, screenY);
            if (element) {
                const button = element.closest('button');
                if (button) {
                    button.click();
                    btnCooldown = 30; // 0.5s cooldown
                    clickedHTMLButton = true;
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
                    newScale = Math.max(0.5, Math.min(newScale, 3));

                    grabbedBlock.mesh.scale.set(newScale, newScale, newScale);
                    grabbedBlock.mesh.material.color.setHex(0xffff00);

                    // Update bentuk fisika
                    updatePhysicsShape(grabbedBlock, newScale);
                }
            }

            if (!isScalingNow) isScaling = false;

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
                    scene.remove(closestBlock.mesh);
                    try { closestBlock.mesh.geometry.dispose(); } catch (e) { }
                    try { closestBlock.mesh.material.dispose(); } catch (e) { }
                    try { world.remove(closestBlock.body); } catch (e) { }
                    blocks = blocks.filter(b => b !== closestBlock);
                    if (grabbedBlock === closestBlock) grabbedBlock = null;
                    btnCooldown = 25;
                    updateStatus('Balok berhasil dihapus.');
                }
            } else {
                // LOGIKA GRABBING & SELECTION (NORMAL MODE)
                if (selectionCooldown > 0) selectionCooldown--;
                const pinchStart = isHand1Pinching && !prevPinch;
                if (pinchStart && selectionCooldown === 0 && closestBlock && btnCooldown < 20) {
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
                        grabbedBlock.body.position.set(pos3D.x, pos3D.y, 0);
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

                        grabbedBlock.isGrabbed = false;
                        grabbedBlock.mesh.material.color.setHex(grabbedBlock.baseColor);
                        grabbedBlock = null;
                    }
                } else if (!isScalingNow && isAnyPinching && closestBlock && btnCooldown < 20) {
                    grabbedBlock = closestBlock;
                    grabbedBlock.isGrabbed = true;
                    grabbedBlock.velocityY = 0;

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
        isScaling = false;
        if (grabbedBlock) {
            grabbedBlock.isGrabbed = false;
            grabbedBlock.body.type = CANNON.Body.DYNAMIC;
            grabbedBlock.body.velocity.set(0, 0, 0);
            grabbedBlock.body.angularVelocity.set(0, 0, 0);
            grabbedBlock.mesh.material.color.setHex(grabbedBlock.baseColor);
            grabbedBlock = null;
        }
    }
});

// ==========================================
// 5. ANIMASI & FISIKA GRAVITASI
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    // Terapkan Device Orientation ke kamera (AR mode)
    applyDeviceOrientation();

    // Majukan simulasi fisika Cannon.js
    world.step(1 / 60);

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];

        // Batasi pergerakan di sumbu Z agar tetap pada plane 2D (Z = 0)
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

if (navHome) navHome.addEventListener('click', () => showScreen('home'));
if (navBuilder) navBuilder.addEventListener('click', () => showScreen('builder'));
if (navHome2) navHome2.addEventListener('click', () => showScreen('home'));
if (navBuilder2) navBuilder2.addEventListener('click', () => showScreen('builder'));

// Carousel simple: highlight selection
const carousel = document.getElementById('carousel');
let selectedBlock = null;
if (carousel) {
    carousel.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (selectedBlock) selectedBlock.style.outline = 'none';
        selectedBlock = btn;
        selectedBlock.style.outline = '3px solid rgba(0,0,0,0.12)';
        // buat/ubah objek 3D berdasarkan data-shape
        console.log('Pilih block:', btn.dataset.shape);
        const shape = btn.dataset.shape || 'cube';
        // warna dari kelas
        let color = 0x2B9CFF;
        if (btn.classList.contains('yellow')) color = 0xFFD24D;
        if (btn.classList.contains('green')) color = 0x39C07A;
        if (btn.classList.contains('red')) color = 0xFF6B6B;
        createOrUpdateBlock(shape, color);
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

// Tombol Ganti Kamera (Depan/Belakang)
const btnSwitchCam = document.getElementById('btn-switch-cam');
if (btnSwitchCam) {
    btnSwitchCam.addEventListener('click', () => {
        switchCamera();
        btnSwitchCam.style.transform = 'scale(0.9)';
        setTimeout(() => btnSwitchCam.style.transform = '', 150);
    });
}

// Create or update the main block object according to selection
function createOrUpdateBlock(shape, colorHex) {
    // Memunculkan balok baru dengan posisi random di sumbu X agar tidak bertumpuk persis
    const randomX = (Math.random() - 0.5) * 4;
    spawnBlock(shape, colorHex, randomX, 3, 0);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    trackingCanvas.width = window.innerWidth;
    trackingCanvas.height = window.innerHeight;
});