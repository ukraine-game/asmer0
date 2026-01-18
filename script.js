const socket = io();
let currentUser = JSON.parse(localStorage.getItem('user'));
let currentRoom = 'general';
let currentGuildId = null;
let peerConnection;
let localStream;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- ІНІЦІАЛІЗАЦІЯ ---
window.onload = async () => {
    if (currentUser) {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'flex';
        updateUI();
        
        socket.emit('identify', currentUser.username);
        
        await loadContacts();
        await loadGuilds();
        switchToGeneral();
    }
};

function updateUI() {
    document.getElementById('my-avatar').src = currentUser.avatar;
    document.getElementById('my-name').innerText = currentUser.username;
    // Для налаштувань
    if(document.getElementById('settings-avatar-preview')) {
        document.getElementById('settings-avatar-preview').src = currentUser.avatar;
        document.getElementById('settings-username-display').innerText = currentUser.username;
    }
}

// --- АВТОРИЗАЦІЯ ---
async function login() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const res = await fetch('/login', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({username: u, password: p}) 
    });
    const data = await res.json();
    if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.user));
        location.reload();
    } else alert("Помилка входу");
}

async function register() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const res = await fetch('/register', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({username: u, password: p}) 
    });
    const data = await res.json();
    alert(data.success ? "Успіх! Увійдіть." : "Помилка реєстрації");
}

// --- СЕРВЕРИ (GUILDS) ---
async function loadGuilds() {
    const res = await fetch(`/api/guilds/list/${currentUser.username}`);
    const guilds = await res.json();
    const list = document.getElementById('user-guilds-list');
    list.innerHTML = '';
    
    guilds.forEach(g => {
        const div = document.createElement('div');
        div.className = 'nav-item';
        div.id = `guild-${g.id}`;
        div.innerHTML = `
            <div class="pill"></div>
            <div class="icon-wrap" title="${g.name}">${g.name[0].toUpperCase()}</div>
        `;
        div.onclick = () => switchToGuild(g);
        list.appendChild(div);
    });
}

async function switchToGuild(guild) {
    currentGuildId = guild.id;
    
    // Візуальна активація
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`guild-${guild.id}`).classList.add('active');

    // UI перемикання
    document.getElementById('dm-area').style.display = 'none';
    document.getElementById('guild-channels-area').style.display = 'block';
    document.getElementById('current-server-name').innerText = guild.name;
    
    document.getElementById('invite-people-btn').style.display = 'block';
    document.getElementById('invite-people-btn').dataset.inviteCode = guild.invite_code;
    document.getElementById('call-btn').style.display = 'none';
    
    await loadChannels(guild.id);
}

async function loadChannels(guildId) {
    const res = await fetch(`/api/guilds/${guildId}/channels`);
    const channels = await res.json();
    const list = document.getElementById('text-channels-list');
    list.innerHTML = '';

    channels.forEach(ch => {
        const div = document.createElement('div');
        div.className = 'private-chat-item';
        div.innerHTML = `<span>#</span> ${ch.name}`;
        div.onclick = () => joinChannel(ch);
        list.appendChild(div);
    });
}

function joinChannel(channel) {
    currentRoom = `channel_${channel.id}`;
    document.getElementById('chat-title').innerText = channel.name;
    document.getElementById('messages').innerHTML = '';
    socket.emit('join-room', currentRoom);
    loadHistory(currentRoom);
}

// --- ПРИВАТНІ ЧАТИ ---
function switchToGeneral() {
    currentGuildId = null;
    currentRoom = 'general';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('home-btn').classList.add('active');
    
    document.getElementById('dm-area').style.display = 'block';
    document.getElementById('guild-channels-area').style.display = 'none';
    
    document.getElementById('chat-title').innerText = 'вітаймо';
    document.getElementById('invite-people-btn').style.display = 'none';
    document.getElementById('call-btn').style.display = 'none';
    
    document.getElementById('messages').innerHTML = '';
    socket.emit('join-room', 'general');
    loadHistory('general');
}

async function startPrivateChat(targetUser) {
    currentGuildId = null;
    currentRoom = [currentUser.username, targetUser].sort().join('_');
    
    document.getElementById('chat-title').innerText = targetUser;
    document.getElementById('call-btn').style.display = 'block';
    document.getElementById('invite-people-btn').style.display = 'none';
    document.getElementById('messages').innerHTML = '';

    const sRes = await fetch(`/api/status/${targetUser}`);
    const sData = await sRes.json();
    document.querySelector('.my-status-text').innerText = sData.status === 'online' ? "Online" : "Offline";

    socket.emit('join-room', currentRoom);
    loadHistory(currentRoom);
    closeModals();
}

// --- ПОВІДОМЛЕННЯ ---
document.getElementById('msg-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
        const text = e.target.value;
        
        // Перевірка прав (опціонально)
        if (currentRoom.startsWith('channel_')) {
            const res = await fetch('/api/permissions/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ guildId: currentGuildId, username: currentUser.username, required: 2 })
            });
            const p = await res.json();
            if(!p.allowed) return alert("Немає прав писати тут");
        }

        socket.emit('message', { 
            room: currentRoom, 
            user: currentUser.username, 
            avatar: currentUser.avatar,
            guildId: currentGuildId,
            text: text 
        });
        e.target.value = '';
    }
});

socket.on('message', (data) => {
    if (data.room === currentRoom) renderMessage(data);
});

function renderMessage(data) {
    const div = document.createElement('div');
    div.className = 'message-item';
    div.innerHTML = `
        <img src="${data.avatar}" class="chat-ava" style="width:40px;height:40px;border-radius:50%;float:left;margin-right:15px;">
        <div>
            <strong style="color:${data.color || 'white'};">${data.user}</strong> 
            <small style="color:#949ba4; margin-left:8px;">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</small>
            <div style="color:#dbdee1; margin-top:4px;">${data.text}</div>
        </div>`;
    const box = document.getElementById('messages');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

// --- ДЗВІНКИ (WebRTC) ---
async function startCall() {
    const targetUser = currentRoom.split('_').find(p => p !== currentUser.username);
    document.getElementById('call-screen').style.display = 'flex';
    document.getElementById('caller-name').innerText = targetUser;

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { to: targetUser, candidate: e.candidate });
    };

    peerConnection.ontrack = (e) => {
        document.getElementById('remote-video').srcObject = e.streams[0];
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-user', { to: targetUser, from: currentUser.username, offer });
}

socket.on('incoming-call', async (data) => {
    if (confirm(`Дзвінок від ${data.from}. Прийняти?`)) {
        document.getElementById('call-screen').style.display = 'flex';
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('ice-candidate', { to: data.from, candidate: e.candidate });
        };
        
        peerConnection.ontrack = (e) => {
            document.getElementById('remote-video').srcObject = e.streams[0];
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer-call', { to: data.from, from: currentUser.username, answer });
    }
});

socket.on('call-answered', (data) => {
    peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', (data) => {
    if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-screen').style.display = 'none';
}

// --- КЕРУВАННЯ МОДАЛКАМИ ТА КОНТАКТАМИ ---
function showFullProfileSettings() { document.getElementById('full-profile-settings').style.display = 'flex'; updateUI(); }
function closeFullSettings() { document.getElementById('full-profile-settings').style.display = 'none'; }
function showGuildModal() { document.getElementById('guild-modal').style.display = 'flex'; }
function closeModals() { 
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); 
}

async function loadContacts() {
    const res = await fetch(`/api/contacts/${currentUser.username}`);
    const contacts = await res.json();
    const list = document.getElementById('private-chats');
    list.innerHTML = '';
    contacts.forEach(c => addChatToList(c.contact));
}

function addChatToList(name) {
    const list = document.getElementById('private-chats');
    if ([...list.childNodes].some(el => el.dataset.user === name)) return;
    const div = document.createElement('div');
    div.className = 'private-chat-item';
    div.dataset.user = name;
    div.innerHTML = `<span>👤</span> ${name}`;
    div.onclick = () => startPrivateChat(name);
    list.appendChild(div);
}

async function loadHistory(room) {
    const res = await fetch(`/api/messages/${room}`);
    const messages = await res.json();
    messages.forEach(renderMessage);
}

function logout() {
    localStorage.clear();
    location.reload();
}