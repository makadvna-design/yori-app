import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. Танзимоти Firebase (Конфигуратсияи худро ин ҷо гузоред)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Танзимоти глобалӣ
let confirmationResult = null;
let myPhone = null;
let activeFriendPhone = null;
let peer = null;
let currentCall = null;
let localStream = null;

// DOM Elements
const authView = document.getElementById("authView");
const mainView = document.getElementById("mainView");
const phoneStep = document.getElementById("phoneStep");
const codeStep = document.getElementById("codeStep");
const phoneNumberInput = document.getElementById("phoneNumberInput");
const smsCodeInput = document.getElementById("smsCodeInput");

// --- АВТЕНТИФИКАТСИЯ (SMS LOGINS) ---

window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
  'size': 'invisible'
});

document.getElementById("sendCodeBtn").addEventListener("click", () => {
  const phoneNumber = phoneNumberInput.value.trim();
  if (!phoneNumber) return alert("Рақами телефонро ворид кунед!");

  const appVerifier = window.recaptchaVerifier;
  signInWithPhoneNumber(auth, phoneNumber, appVerifier)
    .then((result) => {
      confirmationResult = result;
      phoneStep.classList.add("hidden");
      codeStep.classList.remove("hidden");
    })
    .catch((error) => alert("Хатоги ҳангоми фиристодани код: " + error.message));
});

document.getElementById("verifyCodeBtn").addEventListener("click", () => {
  const code = smsCodeInput.value.trim();
  if (!code) return alert("Кодро ворид кунед!");

  confirmationResult.confirm(code)
    .then((result) => {
      console.log("Воридшавӣ муваффақ шуд!", result.user);
    })
    .catch((error) => alert("Коди нодуруст: " + error.message));
});

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// Назорати ҳолати корбар
onAuthStateChanged(auth, (user) => {
  if (user) {
    myPhone = user.phoneNumber;
    authView.classList.add("hidden");
    mainView.classList.remove("hidden");
    initPeerService(); // Инициализатсияи зангҳо
  } else {
    myPhone = null;
    authView.classList.remove("hidden");
    mainView.classList.add("hidden");
    if(peer) peer.destroy();
  }
});

// --- ЧАТ ВА ПАЁМҲО ---

document.getElementById("startChatBtn").addEventListener("click", () => {
  const phone = document.getElementById("friendPhoneInput").value.trim();
  if (!phone) return;
  openChat(phone);
});

function openChat(friendPhone) {
  activeFriendPhone = friendPhone;
  document.getElementById("noChatSelected").classList.add("hidden");
  document.getElementById("activeChat").classList.remove("hidden");
  document.getElementById("activeFriendPhone").textContent = friendPhone;

  loadMessages();
}

// Фиристодани паём
document.getElementById("sendMessageBtn").addEventListener("click", sendMessage);
document.getElementById("messageInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

async function sendMessage() {
  const text = document.getElementById("messageInput").value.trim();
  if (!text || !activeFriendPhone) return;

  document.getElementById("messageInput").value = "";

  await addDoc(collection(db, "messages"), {
    sender: myPhone,
    receiver: activeFriendPhone,
    text: text,
    timestamp: serverTimestamp()
  });
}

// Гӯш кардани паёмҳо
function loadMessages() {
  const q = query(
    collection(db, "messages"),
    orderBy("timestamp", "asc")
  );

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById("messagesContainer");
    container.innerHTML = "";

    snapshot.docs.forEach((doc) => {
      const msg = doc.data();
      if (
        (msg.sender === myPhone && msg.receiver === activeFriendPhone) ||
        (msg.sender === activeFriendPhone && msg.receiver === myPhone)
      ) {
        const div = document.createElement("div");
        div.className = `msg ${msg.sender === myPhone ? 'my' : 'friend'}`;
        div.textContent = msg.text;
        container.appendChild(div);
      }
    });

    container.scrollTop = container.scrollHeight;
  });
}

// --- WEBRTC / PEERJS (ЗАНГҲО) ---

function initPeerService() {
  const cleanPhone = myPhone.replace("+", "");
  peer = new Peer(cleanPhone);

  // Қабули занг
  peer.on('call', async (call) => {
    const confirmCall = confirm("Занги омада истода! Қабул мекунед?");
    if (confirmCall) {
      document.getElementById("callModal").classList.remove("hidden");
      document.getElementById("callStatusTitle").textContent = "Дар алоқа...";

      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;

        call.answer(localStream);
        currentCall = call;

        call.on('stream', (remoteStream) => {
          document.getElementById("remoteVideo").srcObject = remoteStream;
        });

        call.on('close', endCall);
      } catch (err) {
        alert("Хатогӣ ҳангоми пайваст кардани камера: " + err.message);
        endCall();
      }
    } else {
      call.close();
    }
  });
}

// Оғози занг
async function startCall(isVideo) {
  if (!activeFriendPhone) return alert("Аввал чатро интихоб кунед!");

  const targetPeerId = activeFriendPhone.replace("+", "");
  document.getElementById("callModal").classList.remove("hidden");
  document.getElementById("callStatusTitle").textContent = "Занг рафта истодааст...";

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById("localVideo").srcObject = localStream;

    const call = peer.call(targetPeerId, localStream);
    currentCall = call;

    call.on('stream', (remoteStream) => {
      document.getElementById("callStatusTitle").textContent = "Дар алоқа...";
      document.getElementById("remoteVideo").srcObject = remoteStream;
    });

    call.on('close', endCall);
  } catch (err) {
    alert("Хатогӣ дар пайвасти видео/микрофон: " + err.message);
    endCall();
  }
}

// Анҷоми занг
function endCall() {
  if (currentCall) currentCall.close();
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  document.getElementById("callModal").classList.add("hidden");
  currentCall = null;
  localStream = null;
}

// Event Listeners барои занг
document.getElementById("audioCallBtn").addEventListener("click", () => startCall(false));
document.getElementById("videoCallBtn").addEventListener("click", () => startCall(true));
document.getElementById("endCallBtn").addEventListener("click", endCall);