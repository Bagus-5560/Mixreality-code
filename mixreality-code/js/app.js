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

// Objek Balok (Kubus)
const boxGeo = new THREE.BoxGeometry(2, 2, 2);
const boxMat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const balok = new THREE.Mesh(boxGeo, boxMat);
balok.position.y = 0;
scene.add(balok);

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

let showTracking = false;
let btnCooldown = 0; 
let cameraUtils;

const trackingCanvas = document.getElementById('tracking_canvas');
const trackingCtx = trackingCanvas.getContext('2d');
trackingCanvas.width = window.innerWidth;
trackingCanvas.height = window.innerHeight;

const videoElement = document.getElementById('webcam');
const btnTracking = document.getElementById('btn-tracking');
const statusEl = document.getElementById('status');

// ==========================================
// 3. FUNGSI BANTUAN MATEMATIKA & KAMERA
// ==========================================
function mapTo3DSpace(x, y) {
    const mirroredX = 1 - x; 
    return { x: (mirroredX - 0.5) * 14, y: -(y - 0.5) * 10 };
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
            height: 480
        });
    }

    cameraUtils.start()
        .then(() => {
            updateStatus('Kamera aktif. Tunjukkan tangan ke depan kamera.');
        })
        .catch((error) => {
            console.error('Gagal mengakses kamera:', error);
            updateStatus('Gagal menyalakan kamera. Izinkan kamera di browser.', true);
        });
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
const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

hands.onResults((results) => {
    // 4A. MENGGAMBAR GARIS TRACKING
    trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
    if (showTracking && results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(trackingCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 3});
            drawLandmarks(trackingCtx, landmarks, {color: '#FF0000', lineWidth: 1});
        }
    }

    isGrabbed = false;
    if (btnCooldown > 0) btnCooldown--; 

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand1 = results.multiHandLandmarks[0];
        const hand2 = results.multiHandLandmarks.length > 1 ? results.multiHandLandmarks[1] : null;

        const pinchDist1 = getDistance(hand1[4], hand1[8]);
        const isHand1Pinching = pinchDist1 < 0.12;
        const midX1 = (hand1[4].x + hand1[8].x) / 2;
        const midY1 = (hand1[4].y + hand1[8].y) / 2;
        const pos3D = mapTo3DSpace(midX1, midY1);

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
        if (hand2) {
            const pinchDist2 = getDistance(hand2[4], hand2[8]);
            const isHand2Pinching = pinchDist2 < 0.12;

            if (isHand1Pinching && isHand2Pinching) {
                isScalingNow = true;
                const currentDistance = getDistance(hand1[8], hand2[8]);

                if (!isScaling) {
                    isScaling = true;
                    initialHandsDistance = currentDistance;
                    initialBalokScale = balok.scale.x; 
                } else {
                    let scaleFactor = currentDistance / initialHandsDistance;
                    let newScale = initialBalokScale * scaleFactor;
                    newScale = Math.max(0.5, Math.min(newScale, 3)); 
                    
                    balok.scale.set(newScale, newScale, newScale);
                    balok.material.color.setHex(0xffff00); 
                }
            }
        }
        
        if (!isScalingNow) isScaling = false;

        // 4D. LOGIKA GRABBING (1 Tangan)
        const hitArea = balok.scale.x * 2; 
        const distToBalokX = Math.abs(pos3D.x - balok.position.x);
        const distToBalokY = Math.abs(pos3D.y - balok.position.y);

        if (!isScalingNow && isHand1Pinching && distToBalokX < hitArea && distToBalokY < hitArea && btnCooldown < 20) {
            isGrabbed = true;
            balok.position.x = pos3D.x;
            balok.position.y = pos3D.y;
            velocityY = 0; 
            balok.material.color.setHex(0xff0000); 
        } 
        else if (!isGrabbed && !isScalingNow) {
            balok.material.color.setHex(0x00ff00); 
        }

    } else {
        isScaling = false;
        balok.material.color.setHex(0x00ff00);
    }
});

// ==========================================
// 5. ANIMASI & FISIKA GRAVITASI
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    
    if (!isGrabbed) {
        velocityY -= gravity;
        balok.position.y += velocityY;
        
        const bottomEdge = floorY + (balok.scale.y * 1);
        if (balok.position.y <= bottomEdge) {
            balok.position.y = bottomEdge;
            velocityY = 0;
        }
    } else {
        balok.rotation.x += 0.02;
        balok.rotation.y += 0.02;
    }

    renderer.render(scene, camera);
}

// Jalankan animasi secara terus-menerus
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    trackingCanvas.width = window.innerWidth;
    trackingCanvas.height = window.innerHeight;
});