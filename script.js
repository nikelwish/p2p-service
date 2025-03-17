let peer = null;
let conn = null;
let localStream = null;
let mediaRecorder = null;
let remoteMediaRecorder = null;
let recordedChunks = [];
let currentCall = null;
let facingMode = 'user'; // начинаем с фронтальной камеры
let screenStream = null;
let pendingFile = null;
let customPeerId = null; // для хранения пользовательского ID

// Новые переменные для улучшенной системы подключения
let contacts = []; // массив контактов
let userStatus = 'available'; // статус пользователя: available, busy, away
let incomingConnRequests = []; // запросы на соединение
let activeRoom = null; // текущая активная комната
let roomParticipants = []; // участники комнаты для группового чата

// Проверка поддержки уведомлений
let notificationPermission = false;

// Регистрация Service Worker для PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('ServiceWorker зарегистрирован: ', registration.scope);
            })
            .catch(error => {
                console.error('Ошибка регистрации ServiceWorker: ', error);
            });
    });
}

// Запрос разрешений для нативных функций
async function requestPermissions() {
    try {
        // Разрешение на уведомления
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            notificationPermission = permission === 'granted';
        } else {
            notificationPermission = Notification.permission === 'granted';
        }
    } catch (err) {
        console.error('Ошибка запроса разрешений:', err);
    }
}

// Отображение уведомления
function showNotification(message, timeout = 3000) {
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    
    notificationMessage.textContent = message;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, timeout);
    
    // Также отправляем системное уведомление, если есть разрешение
    if (notificationPermission && document.visibilityState !== 'visible') {
        new Notification('P2P Чат', {
            body: message,
            icon: '/icons/icon-192x192.png'
        });
    }
}

// Генерация пользовательского ID
function generateUserId() {
    // Проверяем, существует ли уже сохраненный ID
    const savedId = localStorage.getItem('peerId');
    if (savedId) {
        return savedId;
    }
    
    // Если нет, генерируем случайный ID и сохраняем
    const randomId = Math.random().toString(36).substring(2, 10);
    localStorage.setItem('peerId', randomId);
    return randomId;
}

// Изменение ID пользователя
function changeUserId() {
    // Запрашиваем новый ID
    const newId = prompt('Введите новый ID (только латинские буквы и цифры):');
    
    if (!newId) {
        return;
    }
    
    // Проверяем на валидность (только буквы и цифры)
    if (!/^[a-zA-Z0-9]+$/.test(newId)) {
        showNotification('ID может содержать только латинские буквы и цифры');
        return;
    }
    
    // Сохраняем новый ID
    localStorage.setItem('peerId', newId);
    showNotification('ID изменен. Перезагрузите страницу для применения изменений');
    
    // Предлагаем перезагрузить страницу
    if (confirm('Перезагрузить страницу сейчас для применения нового ID?')) {
        window.location.reload();
    }
}

// Инициализация PeerJS
function initializePeer() {
    // Получаем или генерируем ID пользователя
    customPeerId = generateUserId();
    
    console.log("Инициализация PeerJS с ID:", customPeerId);
    
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ];
    
    console.log("Используем ICE серверы:", iceServers);
    
    const peerOptions = {
        debug: 3, // вывод отладочной информации (0-3)
        config: {
            'iceServers': iceServers,
            'iceTransportPolicy': 'all',
            'rtcpMuxPolicy': 'require'
        }
    };
    
    peer = new Peer(customPeerId, peerOptions);
    
    peer.on('open', (id) => {
        console.log("PeerJS соединение установлено. ID:", id);
        document.getElementById('peer-id').textContent = id;
        setUserStatus('available');
        document.getElementById('connection-status').textContent = 'Готов к подключению';
        document.getElementById('connection-status').style.color = 'green';
        
        // Загружаем контакты
        loadContacts();
    });

    peer.on('connection', handleIncomingConnectionRequest);

    peer.on('call', handleIncomingCall);

    peer.on('error', (err) => {
        console.error('Ошибка соединения:', err);
        showNotification('Ошибка соединения: ' + err.type);
        document.getElementById('connection-status').textContent = 'Ошибка';
        document.getElementById('connection-status').style.color = 'red';
        
        // Если ошибка связана с тем, что ID уже занят, генерируем новый
        if (err.type === 'unavailable-id') {
            const newId = Math.random().toString(36).substring(2, 10);
            localStorage.setItem('peerId', newId);
            showNotification('ID занят. Будет использован новый ID: ' + newId);
            
            // Перезагружаем страницу для применения нового ID
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        }
    });
}

// Установка и обновление статуса пользователя
function setUserStatus(status) {
    userStatus = status;
    let statusColor, statusText;
    
    // Обновляем интерфейс в соответствии со статусом
    switch(status) {
        case 'available':
            statusColor = 'green';
            statusText = 'Доступен';
            break;
        case 'busy':
            statusColor = 'red';
            statusText = 'В звонке';
            break;
        case 'away':
            statusColor = 'orange';
            statusText = 'Отошел';
            break;
        default:
            statusColor = 'gray';
            statusText = 'Неизвестно';
    }
    
    // Обновляем отображение статуса в UI
    const statusIndicator = document.getElementById('user-status-indicator');
    if (statusIndicator) {
        statusIndicator.style.backgroundColor = statusColor;
        document.getElementById('user-status-text').textContent = statusText;
    }
    
    console.log("Статус пользователя изменен на:", status);
    
    // Сохраняем статус в localStorage
    localStorage.setItem('userStatus', status);
}

// Обработка входящего запроса на соединение
function handleIncomingConnectionRequest(connection) {
    console.log("Входящий запрос на соединение от:", connection.peer);
    
    // Проверяем, в контактах ли этот пользователь
    const isContact = contacts.some(contact => contact.peerId === connection.peer);
    
    // Если пользователь занят (в звонке) и это не контакт
    if (userStatus === 'busy' && !isContact) {
        console.log("Пользователь занят, отклоняем соединение");
        
        // Отправляем сообщение о занятости
        connection.on('open', () => {
            connection.send({
                type: 'system',
                action: 'busy',
                message: 'Пользователь сейчас занят в другом звонке'
            });
            setTimeout(() => connection.close(), 1000);
        });
        
        showNotification(`Отклонен входящий запрос от ${connection.peer} (вы заняты)`);
        return;
    }
    
    // Если это контакт, автоматически принимаем
    if (isContact) {
        acceptConnection(connection);
        return;
    }
    
    // Добавляем запрос в очередь и показываем уведомление
    incomingConnRequests.push(connection);
    
    // Создаем уведомление о входящем запросе
    showConnectionRequest(connection.peer);
}

// Показать UI для запроса на подключение
function showConnectionRequest(peerId) {
    console.log("Показываем запрос на соединение от:", peerId);
    
    // Создаем элемент для запроса на подключение
    const requestContainer = document.createElement('div');
    requestContainer.id = `conn-request-${peerId}`;
    requestContainer.className = 'connection-request';
    
    requestContainer.innerHTML = `
        <p>Входящий запрос на подключение от: <strong>${peerId}</strong></p>
        <div class="request-actions">
            <button class="accept-btn">Принять</button>
            <button class="reject-btn">Отклонить</button>
            <button class="add-contact-btn">Добавить в контакты</button>
        </div>
    `;
    
    // Добавляем в контейнер запросов
    const requestsContainer = document.getElementById('connection-requests');
    if (requestsContainer) {
        requestsContainer.appendChild(requestContainer);
        requestsContainer.style.display = 'block';
    } else {
        // Если контейнера нет, создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'connection-modal';
        
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Входящий запрос</h3>
                <p>Пользователь ${peerId} хочет подключиться</p>
                <div class="modal-actions">
                    <button onclick="acceptConnectionFromId('${peerId}')">Принять</button>
                    <button onclick="rejectConnectionFromId('${peerId}')">Отклонить</button>
                    <button onclick="addContactAndAccept('${peerId}')">Добавить в контакты и принять</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Покажем модальное окно
        setTimeout(() => {
            modal.style.display = 'flex';
        }, 100);
        
        // Также показываем системное уведомление
        showNotification(`Входящий запрос на подключение от ${peerId}`, 10000);
    }
    
    // Добавляем обработчики для кнопок, если элемент есть
    if (requestContainer) {
        requestContainer.querySelector('.accept-btn').addEventListener('click', () => {
            acceptConnectionFromId(peerId);
        });
        
        requestContainer.querySelector('.reject-btn').addEventListener('click', () => {
            rejectConnectionFromId(peerId);
        });
        
        requestContainer.querySelector('.add-contact-btn').addEventListener('click', () => {
            addContactAndAccept(peerId);
        });
    }
}

// Принять соединение по ID пира
function acceptConnectionFromId(peerId) {
    const connection = incomingConnRequests.find(conn => conn.peer === peerId);
    if (connection) {
        acceptConnection(connection);
        
        // Удаляем из списка запросов
        incomingConnRequests = incomingConnRequests.filter(conn => conn.peer !== peerId);
        
        // Закрываем модальное окно или удаляем элемент запроса
        const requestEl = document.getElementById(`conn-request-${peerId}`);
        if (requestEl) {
            requestEl.remove();
        }
        
        const modal = document.getElementById('connection-modal');
        if (modal) {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
        }
    } else {
        console.error("Соединение не найдено для ID:", peerId);
        showNotification('Ошибка: запрос больше не доступен');
    }
}

// Добавить в контакты и принять
function addContactAndAccept(peerId) {
    addContact(peerId);
    acceptConnectionFromId(peerId);
}

// Отклонить соединение по ID пира
function rejectConnectionFromId(peerId) {
    const connectionIndex = incomingConnRequests.findIndex(conn => conn.peer === peerId);
    
    if (connectionIndex !== -1) {
        const connection = incomingConnRequests[connectionIndex];
        
        // Отправляем сообщение об отклонении, если соединение открыто
        if (connection.open) {
            connection.send({
                type: 'system',
                action: 'rejected',
                message: 'Пользователь отклонил ваш запрос'
            });
        }
        
        // Закрываем соединение
        connection.close();
        
        // Удаляем из списка запросов
        incomingConnRequests.splice(connectionIndex, 1);
        
        // Закрываем модальное окно или удаляем элемент запроса
        const requestEl = document.getElementById(`conn-request-${peerId}`);
        if (requestEl) {
            requestEl.remove();
        }
        
        const modal = document.getElementById('connection-modal');
        if (modal) {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
        }
        
        showNotification(`Запрос от ${peerId} отклонен`);
    } else {
        console.error("Соединение не найдено для ID:", peerId);
        showNotification('Ошибка: запрос больше не доступен');
    }
}

// Принять входящее соединение
function acceptConnection(connection) {
    console.log("Принимаем соединение от:", connection.peer);
    
    if (conn) {
        // Если у нас уже есть активное соединение, закрываем его
        conn.close();
    }
    
    conn = connection;
    
    // Настраиваем обработку событий для нового соединения
    setupConnection();
    
    // Устанавливаем статус пользователя как занятый
    setUserStatus('busy');
    
    // Обновляем UI
    document.getElementById('connection-status').textContent = 'Подключен';
    document.getElementById('connection-status').style.color = 'green';
    document.getElementById('remote-name').textContent = connection.peer;
    
    // Находим имя контакта, если есть
    const contact = contacts.find(c => c.peerId === connection.peer);
    if (contact) {
        document.getElementById('remote-name').textContent = contact.name;
    }
    
    showNotification(`Соединение с ${contact ? contact.name : connection.peer} установлено`);
    
    // Закрываем боковое меню на мобильных после успешного подключения
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }
}

// Инициировать соединение с другим пиром
function initiateConnection(peerId) {
    if (!peerId) {
        showNotification('Введите ID собеседника');
        return;
    }

    // Проверяем, не пытается ли пользователь подключиться к самому себе
    if (peerId === customPeerId) {
        showNotification('Вы не можете подключиться к самому себе');
        return;
    }

    // Если уже есть активное соединение
    if (userStatus === 'busy' && conn) {
        if (confirm('У вас уже есть активное соединение. Закрыть его и начать новое?')) {
            closeCurrentConnection();
        } else {
            return;
        }
    }

    try {
        console.log("Подключаемся к:", peerId);
        document.getElementById('connection-status').textContent = 'Подключение...';
        
        // Создаем соединение для данных
        console.log("Инициируем соединение с метаданными о запросе");
        conn = peer.connect(peerId, {
            reliable: true,
            serialization: 'json',
            metadata: {
                userId: customPeerId,
                requestType: 'connection',
                username: localStorage.getItem('username') || customPeerId
            }
        });
        
        conn.on('open', function() {
            console.log("Соединение открыто");
            
            // Отправляем запрос на подключение
            conn.send({
                type: 'system',
                action: 'connection_request',
                message: 'Запрос на подключение'
            });
            
            setupConnection();
            
            // Устанавливаем статус "в ожидании"
            document.getElementById('connection-status').textContent = 'Ожидание ответа...';
            document.getElementById('connection-status').style.color = 'orange';
            
            showNotification(`Запрос на подключение отправлен ${peerId}`);
        });
        
        conn.on('error', (err) => {
            console.error('Ошибка подключения:', err);
            showNotification('Не удалось подключиться к ' + peerId);
            document.getElementById('connection-status').textContent = 'Ошибка';
            document.getElementById('connection-status').style.color = 'red';
            setUserStatus('available');
        });
    } catch (err) {
        console.error('Ошибка при создании соединения:', err);
        showNotification('Не удалось подключиться');
        setUserStatus('available');
    }
}

// Закрыть текущее соединение
function closeCurrentConnection() {
    if (conn) {
        // Отправляем сообщение о завершении соединения
        if (conn.open) {
            conn.send({
                type: 'system',
                action: 'disconnected',
                message: 'Пользователь завершил соединение'
            });
        }
        
        conn.close();
        conn = null;
    }
    
    // Закрываем текущий звонок, если есть
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    
    // Очищаем UI
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('connection-status').textContent = 'Не подключен';
    document.getElementById('connection-status').style.color = 'gray';
    document.getElementById('remote-name').textContent = 'Собеседник';
    document.getElementById('messages').innerHTML = '';
    
    // Устанавливаем статус как доступный
    setUserStatus('available');
    
    showNotification('Соединение закрыто');
}

// Обработка входящего видеозвонка
function handleIncomingCall(call) {
    console.log("Входящий звонок от:", call.peer, "с метаданными:", call.metadata);
    
    // Если пользователь не в состоянии "занят", показываем запрос на звонок
    if (userStatus !== 'busy' || (conn && conn.peer === call.peer)) {
        showIncomingCallRequest(call);
    } else {
        // Если пользователь занят, отклоняем вызов
        console.log("Пользователь занят, отклоняем звонок");
        call.close();
        
        // Отправляем сообщение о занятости, если есть соединение
        if (peer.connections[call.peer] && peer.connections[call.peer][0]) {
            const connection = peer.connections[call.peer][0];
            if (connection.open) {
                connection.send({
                    type: 'system',
                    action: 'busy',
                    message: 'Пользователь занят в другом звонке'
                });
            }
        }
        
        return;
    }
}

// Показать запрос на входящий звонок
function showIncomingCallRequest(call) {
    // Находим имя контакта, если есть
    let callerName = call.peer;
    const contact = contacts.find(c => c.peerId === call.peer);
    if (contact) {
        callerName = contact.name;
    }
    
    showNotification(`Входящий видеозвонок от ${callerName}`, 10000);
    
    // Если у нас уже есть соединение с этим пиром, автоматически принимаем звонок
    if (conn && conn.peer === call.peer) {
        acceptIncomingCall(call);
        return;
    }
    
    // Создаем модальное окно для запроса
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'incoming-call-modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Входящий видеозвонок</h3>
            <p>Пользователь ${callerName} вызывает вас</p>
            <div class="modal-actions">
                <button class="accept-btn" id="accept-call">Ответить</button>
                <button class="reject-btn" id="reject-call">Отклонить</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Показываем модальное окно
    setTimeout(() => {
        modal.style.display = 'flex';
        
        // Добавляем обработчики для кнопок
        document.getElementById('accept-call').addEventListener('click', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
            acceptIncomingCall(call);
        });
        
        document.getElementById('reject-call').addEventListener('click', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
            call.close();
            showNotification('Звонок отклонен');
        });
        
        // Автоматически закрываем модальное окно, если звонок был отменен
        call.on('close', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
        });
    }, 100);
    
    // Воспроизводим звук звонка
    playRingtone();
}

// Воспроизведение звука звонка
function playRingtone() {
    // Проверяем, есть ли уже аудиоэлемент
    let ringtone = document.getElementById('ringtone');
    
    if (!ringtone) {
        ringtone = document.createElement('audio');
        ringtone.id = 'ringtone';
        ringtone.loop = true;
        
        // Используем встроенный системный звук или добавляем свой
        ringtone.innerHTML = `
            <source src="https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=ringtone-126505.mp3" type="audio/mpeg">
            <source src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YRAAAAB9AH0AfQB9AH0AfQB9AH0=" type="audio/wav">
        `;
        
        document.body.appendChild(ringtone);
    }
    
    // Пробуем воспроизвести звук
    ringtone.play().catch(e => {
        console.error("Не удалось воспроизвести рингтон:", e);
    });
}

// Остановка звука звонка
function stopRingtone() {
    const ringtone = document.getElementById('ringtone');
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
}

// Принять входящий звонок
function acceptIncomingCall(call) {
    console.log("Принимаем входящий звонок");
    
    // Останавливаем звук звонка
    stopRingtone();
    
    if (currentCall) {
        console.log("Уже есть активный звонок, отключаем");
        currentCall.close();
    }
    
    // Устанавливаем новый звонок
    currentCall = call;
    
    // Обновляем статус
    setUserStatus('busy');
    
    // Проверяем соединение
    if (!conn || conn.peer !== call.peer) {
        // Если нет соединения или оно с другим пиром, создаем новое
        if (conn) conn.close();
        
        conn = peer.connect(call.peer, {
            reliable: true,
            serialization: 'json'
        });
        
        conn.on('open', () => {
            setupConnection();
        });
    }
    
    // Отвечаем на звонок с нашим видеопотоком
    console.log("Отвечаем на звонок, отправляем наш поток");
    const answerOptions = {
        metadata: {
            userId: customPeerId,
            hasVideo: localStream.getVideoTracks().length > 0,
            hasAudio: localStream.getAudioTracks().length > 0
        }
    };
    
    call.answer(localStream, answerOptions);
    setupCallEvents(call);
}

// Инициировать видеозвонок
function initiateCall(peerId) {
    if (!localStream) {
        console.error("Нет локального потока для звонка");
        showNotification('Нет доступа к камере или микрофону');
        return;
    }
    
    console.log("Инициируем видеозвонок для", peerId);
    
    // Настройки вызова
    const callOptions = {
        metadata: {
            userId: customPeerId,
            hasVideo: localStream.getVideoTracks().length > 0,
            hasAudio: localStream.getAudioTracks().length > 0
        }
    };
    
    // Создаем звонок
    currentCall = peer.call(peerId, localStream, callOptions);
    
    if (currentCall) {
        setupCallEvents(currentCall);
        showNotification('Вызов...');
    } else {
        console.error("Не удалось инициировать вызов");
        showNotification('Не удалось начать видеозвонок');
    }
}

// Настройка видеопотока
async function setupVideo() {
    try {
        console.log("Запрашиваем доступ к камере и микрофону...");
        
        // Проверяем наличие медиа-устройств
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideoInput = devices.some(device => device.kind === 'videoinput');
        const hasAudioInput = devices.some(device => device.kind === 'audioinput');
        
        console.log("Доступные устройства:", {
            видеоустройства: devices.filter(d => d.kind === 'videoinput').length,
            аудиоустройства: devices.filter(d => d.kind === 'audioinput').length
        });
        
        if (!hasVideoInput && !hasAudioInput) {
            console.warn("Не обнаружено ни камеры, ни микрофона");
            showNotification('Не обнаружены медиа-устройства');
            
            // Создаем пустой поток
            localStream = new MediaStream();
            return true;
        }
        
        // Сначала пробуем получить видео и аудио
        const constraints = {
            video: hasVideoInput ? { 
                facingMode: facingMode,
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            } : false,
            audio: hasAudioInput ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } : false
        };
        
        console.log("Пытаемся получить медиапоток с параметрами:", constraints);
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log("Доступ получен, видео и аудио доступны");
        console.log("Аудиотреки:", localStream.getAudioTracks().length);
        console.log("Видеотреки:", localStream.getVideoTracks().length);
        
        // Проверяем наличие видеотрека
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = true;
            console.log("Видеотрек активирован:", videoTrack.label);
            
            // Получаем настройки видео
            if (videoTrack.getSettings) {
                const settings = videoTrack.getSettings();
                console.log("Настройки видео:", settings);
            }
        }
        
        // Проверяем наличие аудиотрека
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = true;
            console.log("Аудиотрек активирован:", audioTrack.label);
        }
        
        // Подключаем локальный видеопоток к элементу видео
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        
        // Проверяем, что видео воспроизводится
        localVideo.onloadedmetadata = () => {
            localVideo.play().catch(e => {
                console.error("Ошибка при воспроизведении локального видео:", e);
            });
        };
        
        return true;
    } catch (err) {
        console.error('Ошибка доступа к медиа-устройствам:', err);
        showNotification('Ошибка доступа к камере: ' + (err.name || err.message || 'Неизвестная ошибка'));
        
        // Пробуем получить поочередно только видео или только аудио
        try {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showNotification('Доступ к камере и микрофону запрещен');
                localStream = new MediaStream();
                return true;
            }
            
            console.log("Пробуем получить только аудио...");
            localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            console.log("Доступ к аудио получен");
            document.getElementById('local-video').srcObject = localStream;
            showNotification('Доступен только микрофон');
            return true;
        } catch (audioErr) {
            console.error('Ошибка доступа к микрофону:', audioErr);
            
            try {
                console.log("Пробуем получить только видео...");
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facingMode },
                    audio: false
                });
                console.log("Доступ к видео получен");
                document.getElementById('local-video').srcObject = localStream;
                showNotification('Доступно только видео без звука');
                return true;
            } catch (videoErr) {
                console.error('Ошибка доступа к видео:', videoErr);
                
                // Создаем пустой поток для возможности приема видео
                console.log("Создаем пустой поток...");
                localStream = new MediaStream();
                showNotification('Вы сможете видеть и слышать собеседника, но он вас - нет');
                return true;
            }
        }
    }
}

// Переключение между фронтальной и задней камерой
async function switchCamera() {
    if (!localStream) return;
    
    // Останавливаем все текущие треки
    localStream.getTracks().forEach(track => {
        track.stop();
    });
    
    // Меняем режим камеры
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode },
            audio: true
        });
        
        document.getElementById('local-video').srcObject = localStream;
        
        // Если есть активный звонок, нужно обновить поток в нем
        if (currentCall) {
            const videoTrack = localStream.getVideoTracks()[0];
            const sender = currentCall.peerConnection.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            
            if (sender) {
                sender.replaceTrack(videoTrack);
            }
        }
        
        showNotification('Камера ' + (facingMode === 'user' ? 'фронтальная' : 'задняя'));
    } catch (err) {
        console.error('Ошибка переключения камеры:', err);
        showNotification('Не удалось переключить камеру');
    }
}

// Включение/выключение видео
function toggleVideo() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        document.getElementById('toggle-video').innerHTML = videoTrack.enabled ? 
            '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        document.getElementById('toggle-camera').innerHTML = videoTrack.enabled ? 
            '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    }
}

// Включение/выключение аудио
function toggleAudio() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById('toggle-audio').innerHTML = audioTrack.enabled ? 
            '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        document.getElementById('toggle-mic').innerHTML = audioTrack.enabled ? 
            '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
}

// Сделать скриншот
function takeSnapshot() {
    let video = document.getElementById('remote-video');
    const canvas = document.createElement('canvas');
    
    // Если нет видеопотока в удаленном видео, берем локальный
    if (!video.srcObject || !video.srcObject.getVideoTracks().length) {
        console.log("Нет удаленного видеопотока, берем локальный");
        video = document.getElementById('local-video');
    }
    
    if (!video.srcObject || !video.srcObject.getVideoTracks().length) {
        console.log("Нет доступных видеопотоков для скриншота");
        showNotification('Нет видеопотока для скриншота');
        return;
    }
    
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) {
        console.log("Видео не готово, размеры равны нулю");
        showNotification('Видео не готово для скриншота');
        return;
    }
    
    console.log("Делаем скриншот, размеры:", videoWidth, "x", videoHeight);
    
    // Настраиваем холст под размер видео
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    
    // Рисуем кадр на холсте
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, videoWidth, videoHeight);
    
    // Получаем изображение в формате base64
    const imageDataUrl = canvas.toDataURL('image/png');
    
    // Показываем диалог предпросмотра
    const snapshotPreview = document.getElementById('snapshot-preview');
    const snapshotImage = document.getElementById('snapshot-image');
    
    snapshotImage.src = imageDataUrl;
    snapshotPreview.style.display = 'flex';
    
    // Обработчик для кнопки скачивания
    document.getElementById('download-snapshot').onclick = () => {
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = 'snapshot_' + new Date().toISOString() + '.png';
        link.click();
    };
    
    // Обработчик для кнопки "Поделиться"
    document.getElementById('share-snapshot').onclick = async () => {
        if (navigator.share) {
            try {
                // Преобразуем base64 в Blob
                const response = await fetch(imageDataUrl);
                const blob = await response.blob();
                const file = new File([blob], 'snapshot.png', { type: 'image/png' });
                
                await navigator.share({
                    title: 'Снимок экрана',
                    files: [file]
                });
            } catch (err) {
                console.error('Ошибка при попытке поделиться:', err);
                showNotification('Не удалось поделиться снимком');
            }
        } else {
            showNotification('Функция "Поделиться" не поддерживается');
        }
    };
    
    // Закрытие диалога
    document.getElementById('close-snapshot').onclick = () => {
        snapshotPreview.style.display = 'none';
    };
}

// Настройка соединения
function setupConnection() {
    conn.on('data', (data) => {
        // Проверяем, не системное ли это сообщение
        if (typeof data === 'object' && data.type === 'system') {
            handleSystemMessage(data);
            return;
        }
        
        // Проверяем, не файл ли это
        if (typeof data === 'object' && data.type === 'file') {
            receiveFile(data);
        } else {
            addMessage(data, false);
            
            // Отправляем уведомление, если страница неактивна
            if (document.visibilityState !== 'visible') {
                showNotification('Новое сообщение: ' + data);
            }
        }
    });

    conn.on('close', () => {
        console.log("Соединение закрыто");
        conn = null;
        document.getElementById('connection-status').textContent = 'Соединение закрыто';
        document.getElementById('connection-status').style.color = 'red';
        document.getElementById('remote-video').srcObject = null;
        showNotification('Соединение закрыто');
        
        // Возвращаем статус к "доступен"
        setUserStatus('available');
    });
    
    conn.on('error', (err) => {
        console.error("Ошибка соединения:", err);
        showNotification('Ошибка соединения');
        
        // Если соединение еще активно, попробуем его закрыть
        if (conn) {
            conn.close();
            conn = null;
        }
        
        setUserStatus('available');
    });
}

// Обработка системных сообщений
function handleSystemMessage(data) {
    console.log("Получено системное сообщение:", data);
    
    switch(data.action) {
        case 'connection_request':
            // Уже обрабатывается в handleIncomingConnectionRequest
            break;
            
        case 'busy':
            // Пользователь занят
            showNotification('Пользователь занят в другом звонке');
            document.getElementById('connection-status').textContent = 'Пользователь занят';
            document.getElementById('connection-status').style.color = 'red';
            
            // Закрываем соединение
            if (conn) {
                conn.close();
                conn = null;
            }
            
            setUserStatus('available');
            break;
            
        case 'rejected':
            // Пользователь отклонил запрос
            showNotification('Пользователь отклонил ваш запрос');
            document.getElementById('connection-status').textContent = 'Запрос отклонен';
            document.getElementById('connection-status').style.color = 'red';
            
            // Закрываем соединение
            if (conn) {
                conn.close();
                conn = null;
            }
            
            setUserStatus('available');
            break;
            
        case 'accepted':
            // Пользователь принял запрос
            showNotification('Соединение установлено');
            document.getElementById('connection-status').textContent = 'Подключен';
            document.getElementById('connection-status').style.color = 'green';
            
            // Инициируем видеозвонок, если есть доступ к медиа
            if (localStream) {
                initiateCall(conn.peer);
            }
            
            setUserStatus('busy');
            break;
            
        case 'disconnected':
            // Пользователь завершил соединение
            showNotification('Пользователь завершил соединение');
            
            // Закрываем соединение с нашей стороны
            closeCurrentConnection();
            break;
            
        case 'room_invitation':
            // Приглашение в групповую комнату
            handleRoomInvitation(data);
            break;
            
        default:
            console.log("Неизвестное системное сообщение:", data);
    }
}

// Обработка приглашения в групповую комнату
function handleRoomInvitation(data) {
    if (!data.roomId) {
        console.error("Получено приглашение в комнату без ID комнаты");
        return;
    }
    
    const roomId = data.roomId;
    const hostId = data.hostId || conn.peer;
    
    // Показываем приглашение
    showNotification(`Приглашение в групповой чат от ${hostId}`);
    
    // Создаем модальное окно с приглашением
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'room-invitation-modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Приглашение в групповой чат</h3>
            <p>Пользователь ${hostId} приглашает вас в групповой чат</p>
            <div class="modal-actions">
                <button onclick="joinRoom('${roomId}', '${hostId}')">Присоединиться</button>
                <button onclick="declineRoomInvitation()">Отклонить</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Показываем модальное окно
    setTimeout(() => {
        modal.style.display = 'flex';
    }, 100);
}

// Присоединиться к комнате
function joinRoom(roomId, hostId) {
    console.log("Присоединяемся к комнате:", roomId, "хост:", hostId);
    
    // Закрываем модальное окно с приглашением
    const modal = document.getElementById('room-invitation-modal');
    if (modal) {
        modal.style.display = 'none';
        setTimeout(() => modal.remove(), 300);
    }
    
    // Если у нас уже есть активное соединение, закрываем его
    if (conn) {
        closeCurrentConnection();
    }
    
    // Устанавливаем активную комнату
    activeRoom = roomId;
    
    // Отправляем запрос на присоединение к комнате
    const hostConn = peer.connect(hostId, {
        reliable: true,
        metadata: {
            userId: customPeerId,
            requestType: 'room_join',
            roomId: roomId
        }
    });
    
    hostConn.on('open', () => {
        // Отправляем сообщение о присоединении
        hostConn.send({
            type: 'system',
            action: 'room_join',
            roomId: roomId,
            userId: customPeerId,
            username: localStorage.getItem('username') || customPeerId
        });
        
        // Сохраняем соединение с хостом
        conn = hostConn;
        setupConnection();
        
        // Обновляем UI для комнаты
        document.getElementById('connection-status').textContent = 'В групповом чате';
        document.getElementById('connection-status').style.color = 'green';
        document.getElementById('remote-name').textContent = `Групповой чат (${roomId})`;
        
        setUserStatus('busy');
        showNotification('Вы присоединились к групповому чату');
    });
    
    hostConn.on('error', (err) => {
        console.error("Ошибка присоединения к комнате:", err);
        showNotification('Не удалось присоединиться к групповому чату');
        activeRoom = null;
    });
}

// Отклонить приглашение в комнату
function declineRoomInvitation() {
    // Закрываем модальное окно с приглашением
    const modal = document.getElementById('room-invitation-modal');
    if (modal) {
        modal.style.display = 'none';
        setTimeout(() => modal.remove(), 300);
    }
    
    // Если есть активное соединение, отправляем отказ
    if (conn && conn.open) {
        conn.send({
            type: 'system',
            action: 'room_join_rejected',
            message: 'Пользователь отклонил приглашение в групповой чат'
        });
    }
    
    showNotification('Вы отклонили приглашение в групповой чат');
}

// Создать групповой чат
function createGroupChat() {
    // Генерируем ID комнаты
    const roomId = 'room_' + Math.random().toString(36).substring(2, 10);
    
    // Устанавливаем активную комнату
    activeRoom = roomId;
    roomParticipants = [
        { id: customPeerId, isHost: true }
    ];
    
    // Обновляем UI
    document.getElementById('connection-status').textContent = 'Создана групповая комната';
    document.getElementById('connection-status').style.color = 'green';
    document.getElementById('remote-name').textContent = `Групповой чат (${roomId})`;
    
    setUserStatus('busy');
    showNotification('Создан групповой чат. Пригласите участников.');
    
    // Показываем диалог для приглашения пользователей
    showGroupInviteDialog(roomId);
}

// Показать диалог для приглашения пользователей в групповой чат
function showGroupInviteDialog(roomId) {
    // Создаем модальное окно для приглашения
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'group-invite-modal';
    
    // Формируем HTML для списка контактов
    let contactsListHtml = '';
    if (contacts.length > 0) {
        contacts.forEach(contact => {
            contactsListHtml += `
                <div class="contact-item">
                    <label>
                        <input type="checkbox" name="contact" value="${contact.peerId}"> ${contact.name}
                    </label>
                </div>
            `;
        });
    } else {
        contactsListHtml = '<p>У вас нет контактов для приглашения</p>';
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Пригласить в групповой чат</h3>
            <p>ID комнаты: <strong>${roomId}</strong></p>
            <div class="contacts-list">
                ${contactsListHtml}
            </div>
            <div class="manual-invite">
                <p>Или введите ID пользователя вручную:</p>
                <input type="text" id="manual-peer-id" placeholder="ID пользователя">
            </div>
            <div class="modal-actions">
                <button id="invite-selected">Пригласить выбранных</button>
                <button id="close-group-invite">Закрыть</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Показываем модальное окно
    setTimeout(() => {
        modal.style.display = 'flex';
        
        // Добавляем обработчики событий
        document.getElementById('invite-selected').addEventListener('click', () => {
            // Собираем выбранные контакты
            const selectedContacts = [];
            const checkboxes = modal.querySelectorAll('input[name="contact"]:checked');
            checkboxes.forEach(checkbox => {
                selectedContacts.push(checkbox.value);
            });
            
            // Проверяем ручной ввод
            const manualId = document.getElementById('manual-peer-id').value.trim();
            if (manualId) {
                selectedContacts.push(manualId);
            }
            
            // Отправляем приглашения
            if (selectedContacts.length > 0) {
                inviteToRoom(roomId, selectedContacts);
                modal.style.display = 'none';
                setTimeout(() => modal.remove(), 300);
            } else {
                showNotification('Выберите контакты для приглашения');
            }
        });
        
        document.getElementById('close-group-invite').addEventListener('click', () => {
            modal.style.display = 'none';
            setTimeout(() => modal.remove(), 300);
        });
    }, 100);
}

// Пригласить пользователей в комнату
function inviteToRoom(roomId, peerIds) {
    if (!roomId || !peerIds.length) return;
    
    console.log("Приглашаем пользователей в комнату:", roomId, peerIds);
    
    peerIds.forEach(peerId => {
        // Проверяем, что не приглашаем себя
        if (peerId === customPeerId) return;
        
        // Создаем соединение с пользователем
        const userConn = peer.connect(peerId, {
            reliable: true,
            metadata: {
                userId: customPeerId,
                requestType: 'room_invitation',
                roomId: roomId
            }
        });
        
        userConn.on('open', () => {
            // Отправляем приглашение
            userConn.send({
                type: 'system',
                action: 'room_invitation',
                roomId: roomId,
                hostId: customPeerId,
                message: 'Приглашение в групповой чат'
            });
            
            showNotification(`Приглашение отправлено: ${peerId}`);
        });
        
        userConn.on('error', (err) => {
            console.error("Ошибка при отправке приглашения:", err);
            showNotification(`Не удалось отправить приглашение: ${peerId}`);
        });
    });
}

// Подключение к пиру
function connectToPeer(peerId) {
    // Используем новую функцию initiateConnection
    initiateConnection(peerId);
    
    // Закрываем боковое меню после нажатия на кнопку подключения на мобильных
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
    }
}

// Настройка событий для видеозвонка
function setupCallEvents(call) {
    // Обработка получения потока от удаленного пира
    call.on('stream', (remoteStream) => {
        console.log("Получен удаленный поток от:", call.peer);
        
        // Проверяем наличие треков в потоке
        console.log("Аудиотреки:", remoteStream.getAudioTracks().length);
        console.log("Видеотреки:", remoteStream.getVideoTracks().length);
        
        // Получаем метаданные о звонке
        const metadata = call.metadata || {};
        console.log("Метаданные вызова:", metadata);
        
        const remoteVideo = document.getElementById('remote-video');
        remoteVideo.srcObject = remoteStream;
        
        // Включаем аудио
        remoteVideo.muted = false;
        
        // Проверяем наличие видеотрека через метаданные
        remoteVideo.onloadedmetadata = () => {
            console.log("Метаданные загружены");
            
            const hasVideoTracks = remoteStream.getVideoTracks().length > 0;
            const videoBox = document.querySelector('.video-box:nth-child(2)');
            
            if (hasVideoTracks) {
                console.log("Видеотреки обнаружены");
                videoBox.style.backgroundColor = "#000";
                showNotification('Видеосвязь установлена');
            } else {
                console.log("Видеотреки отсутствуют");
                videoBox.style.backgroundColor = "#333";
                showNotification('Установлена только аудиосвязь');
            }
            
            // Если удаленный поток поддерживает только аудио, показываем индикатор
            if (metadata.hasVideo === false) {
                console.log("Удаленный пользователь не имеет видео");
                videoBox.classList.add('audio-only');
            }
            
            // Отображаем информацию о звонке для отладки
            showDebugInfo(remoteStream, metadata);
        };
        
        // Обработка ошибок видеопотока
        remoteVideo.onerror = (err) => {
            console.error('Ошибка видеопотока:', err);
            showNotification('Ошибка видеопотока');
        };
        
        // Добавляем обработчик события canplay
        remoteVideo.oncanplay = () => {
            console.log("Видео готово к воспроизведению");
            showNotification('Соединение установлено');
            
            // Пробуем начать воспроизведение
            remoteVideo.play().catch(e => {
                console.error("Ошибка при воспроизведении видео:", e);
                showNotification('Нажмите на экран для воспроизведения видео');
            });
        };
    });
    
    // Информация о состоянии ICE соединения
    if (call.peerConnection) {
        call.peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE состояние изменилось:", call.peerConnection.iceConnectionState);
            
            if (call.peerConnection.iceConnectionState === 'failed' || 
                call.peerConnection.iceConnectionState === 'disconnected') {
                console.error("ICE соединение потеряно");
                showNotification('Проблема с соединением. Попробуйте перезвонить.');
            }
        };
    }
    
    call.on('close', () => {
        console.log("Звонок завершен");
        document.getElementById('remote-video').srcObject = null;
        currentCall = null;
        showNotification('Звонок завершен');
    });
    
    call.on('error', (err) => {
        console.error('Ошибка звонка:', err);
        showNotification('Ошибка видеосвязи');
    });
}

// Отображение отладочной информации о медиапотоке
function showDebugInfo(stream, metadata) {
    console.group("Отладочная информация о соединении");
    
    // Аудио информация
    if (stream.getAudioTracks().length > 0) {
        const audioTrack = stream.getAudioTracks()[0];
        console.log("Аудио трек:", audioTrack.label, "Включен:", audioTrack.enabled);
        console.log("Аудио ограничения:", audioTrack.getConstraints());
    } else {
        console.log("Аудио треки отсутствуют");
    }
    
    // Видео информация
    if (stream.getVideoTracks().length > 0) {
        const videoTrack = stream.getVideoTracks()[0];
        console.log("Видео трек:", videoTrack.label, "Включен:", videoTrack.enabled);
        console.log("Видео ограничения:", videoTrack.getConstraints());
        
        // Параметры видео
        if (videoTrack.getSettings) {
            const settings = videoTrack.getSettings();
            console.log("Видео настройки:", settings);
        }
    } else {
        console.log("Видеотреки отсутствуют");
    }
    
    // Метаданные
    console.log("Метаданные пользователя:", metadata);
    
    console.groupEnd();
}

// Добавление сообщения в чат
function addMessage(text, isSent = true) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    
    // Проверяем, не ссылка ли это
    if (typeof text === 'string' && text.match(/^https?:\/\//i)) {
        const link = document.createElement('a');
        link.href = text;
        link.textContent = text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.appendChild(link);
    } 
    // Если это не ссылка, просто добавляем текст
    else {
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.textContent = text;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Отправка файла
async function shareFile() {
    const fileInput = document.getElementById('file-input');
    fileInput.click();
    
    fileInput.onchange = async function() {
        if (!fileInput.files.length) return;
        
        const file = fileInput.files[0];
        
        // Проверяем размер файла (ограничиваем 15 МБ)
        if (file.size > 15 * 1024 * 1024) {
            showNotification('Файл слишком большой. Максимальный размер - 15 МБ');
            return;
        }
        
        if (!conn) {
            showNotification('Нет активного соединения');
            return;
        }
        
        try {
            // Показываем предпросмотр файла
            const filePreview = document.getElementById('file-preview');
            const fileInfo = document.getElementById('file-info');
            
            pendingFile = file;
            
            // Отображаем информацию о файле
            const sizeInKB = Math.round(file.size / 1024);
            fileInfo.textContent = `${file.name} (${sizeInKB} КБ)`;
            filePreview.style.display = 'flex';
            
            document.getElementById('cancel-file').onclick = () => {
                filePreview.style.display = 'none';
                pendingFile = null;
            };
            
            document.getElementById('send-btn').onclick = async () => {
                if (pendingFile) {
                    await sendFile(pendingFile);
                    filePreview.style.display = 'none';
                    pendingFile = null;
                } else {
                    sendMessage();
                }
            };
        } catch (err) {
            console.error('Ошибка при обработке файла:', err);
            showNotification('Ошибка при обработке файла');
        }
    };
}

// Отправка файла через соединение
async function sendFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Отправляем метаданные файла
        conn.send({
            type: 'file',
            name: file.name,
            size: file.size,
            mimeType: file.type,
            data: Array.from(bytes) // Преобразуем в обычный массив для передачи
        });
        
        addMessage(`Отправлен файл: ${file.name}`, true);
    } catch (err) {
        console.error('Ошибка при отправке файла:', err);
        showNotification('Не удалось отправить файл');
    }
}

// Получение файла
function receiveFile(fileData) {
    try {
        // Создаем Blob из полученных данных
        const bytes = new Uint8Array(fileData.data);
        const blob = new Blob([bytes], { type: fileData.mimeType });
        
        // Создаем ссылку для скачивания
        const url = URL.createObjectURL(blob);
        
        // Добавляем сообщение с ссылкой
        const messagesDiv = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message received';
        
        const fileLink = document.createElement('a');
        fileLink.href = url;
        fileLink.download = fileData.name;
        
        // Определяем тип файла по MIME
        if (fileData.mimeType.startsWith('image/')) {
            // Это изображение
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.style.display = 'block';
            img.style.marginBottom = '5px';
            fileLink.appendChild(img);
        } else if (fileData.mimeType.startsWith('video/')) {
            // Это видео
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '200px';
            video.style.display = 'block';
            video.style.marginBottom = '5px';
            fileLink.appendChild(video);
        }
        
        // Добавляем текст с именем файла
        const fileInfo = document.createElement('div');
        const sizeInKB = Math.round(fileData.size / 1024);
        fileInfo.textContent = `${fileData.name} (${sizeInKB} КБ)`;
        fileLink.appendChild(fileInfo);
        
        messageDiv.appendChild(fileLink);
        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        // Показываем уведомление
        showNotification(`Получен файл: ${fileData.name}`);
    } catch (err) {
        console.error('Ошибка при получении файла:', err);
        showNotification('Ошибка при получении файла');
    }
}

// Копирование ID в буфер обмена
function copyPeerId() {
    const peerId = document.getElementById('peer-id').textContent;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(peerId)
            .then(() => {
                showNotification('ID скопирован в буфер обмена');
            })
            .catch(err => {
                console.error('Не удалось скопировать:', err);
                showNotification('Не удалось скопировать ID');
            });
    } else {
        const input = document.createElement('input');
        input.value = peerId;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showNotification('ID скопирован в буфер обмена');
    }
}

// Переключение полноэкранного режима
function toggleFullscreen() {
    console.log("Переключение полноэкранного режима");
    
    // Проверяем, поддерживается ли полноэкранный режим
    if (!document.fullscreenEnabled && 
        !document.webkitFullscreenEnabled && 
        !document.mozFullScreenEnabled &&
        !document.msFullscreenEnabled) {
        console.log("Полноэкранный режим не поддерживается");
        showNotification('Полноэкранный режим не поддерживается в этом браузере');
        return;
    }
    
    try {
        if (!document.fullscreenElement && 
            !document.webkitFullscreenElement && 
            !document.mozFullScreenElement &&
            !document.msFullscreenElement) {
            
            console.log("Вход в полноэкранный режим");
            
            // Определяем метод для входа в полноэкранный режим
            const element = document.documentElement;
            
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen();
            } else if (element.mozRequestFullScreen) {
                element.mozRequestFullScreen();
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
            }
            
            document.getElementById('fullscreen-toggle').innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            console.log("Выход из полноэкранного режима");
            
            // Определяем метод для выхода из полноэкранного режима
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            
            document.getElementById('fullscreen-toggle').innerHTML = '<i class="fas fa-expand"></i>';
        }
    } catch (err) {
        console.error("Ошибка при переключении полноэкранного режима:", err);
        showNotification('Ошибка при переключении полноэкранного режима');
    }
}

// Проверка и восстановление воспроизведения видео
function checkAndRestoreVideoPlayback() {
    const remoteVideo = document.getElementById('remote-video');
    const localVideo = document.getElementById('local-video');
    
    // Проверяем удаленное видео
    if (remoteVideo.srcObject && remoteVideo.paused) {
        console.log("Удаленное видео приостановлено, пытаемся возобновить");
        remoteVideo.play().catch(e => {
            console.error("Не удалось автоматически возобновить удаленное видео:", e);
        });
    }
    
    // Проверяем локальное видео
    if (localVideo.srcObject && localVideo.paused) {
        console.log("Локальное видео приостановлено, пытаемся возобновить");
        localVideo.play().catch(e => {
            console.error("Не удалось автоматически возобновить локальное видео:", e);
        });
    }
}

// Диагностика и перезапуск медиасоединения
function diagnoseAndFixConnection() {
    console.log("Запуск диагностики соединения...");
    
    // Проверяем состояние соединения
    if (currentCall && currentCall.peerConnection) {
        const pc = currentCall.peerConnection;
        const iceState = pc.iceConnectionState;
        const connState = pc.connectionState;
        const signalState = pc.signalingState;
        
        console.log("Состояние WebRTC соединения:", {
            "ICE": iceState,
            "Connection": connState,
            "Signaling": signalState
        });
        
        // Проверяем каналы передачи данных
        if (pc.getTransceivers) {
            const transceivers = pc.getTransceivers();
            console.log("Каналы передачи данных:", transceivers.length);
            
            transceivers.forEach((transceiver, i) => {
                if (transceiver.receiver && transceiver.receiver.track) {
                    console.log(`Канал ${i+1} (${transceiver.receiver.track.kind}):`, 
                                "активен:", !transceiver.stopped);
                }
            });
        }
        
        // Проблемы с ICE соединением
        if (iceState === 'failed' || iceState === 'disconnected' || connState === 'failed') {
            console.warn("Обнаружена проблема с соединением. Пытаемся перезапустить...");
            showNotification('Проблема с соединением. Пытаемся восстановить...');
            
            // Перезапускаем ICE соединение
            if (pc.restartIce && typeof pc.restartIce === 'function') {
                pc.restartIce();
                console.log("ICE соединение перезапущено");
            } else {
                console.log("Функция restartIce не поддерживается. Пытаемся создать новое соединение.");
                
                // Закрываем текущий звонок
                if (currentCall) {
                    currentCall.close();
                    currentCall = null;
                    
                    // Пробуем перезвонить
                    if (conn && conn.peer) {
                        setTimeout(() => {
                            if (localStream) {
                                console.log("Пытаемся перезвонить...");
                                showNotification('Пытаемся восстановить видео связь...');
                                
                                const callOptions = {
                                    metadata: {
                                        userId: customPeerId,
                                        hasVideo: localStream.getVideoTracks().length > 0,
                                        hasAudio: localStream.getAudioTracks().length > 0,
                                        reconnect: true
                                    }
                                };
                                
                                currentCall = peer.call(conn.peer, localStream, callOptions);
                                
                                if (currentCall) {
                                    setupCallEvents(currentCall);
                                    console.log("Видеозвонок перезапущен");
                                }
                            }
                        }, 1000);
                    }
                }
            }
            
            return true;
        }
        
        // Проверка аудио и видео треков
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo.srcObject) {
            const videoTracks = remoteVideo.srcObject.getVideoTracks();
            const audioTracks = remoteVideo.srcObject.getAudioTracks();
            
            console.log("Удаленные треки:", {
                "видео": videoTracks.length > 0 ? "есть" : "нет",
                "аудио": audioTracks.length > 0 ? "есть" : "нет"
            });
            
            // Проверяем, что видео воспроизводится
            if (remoteVideo.paused && videoTracks.length > 0) {
                console.log("Видео на паузе, пытаемся возобновить");
                remoteVideo.play().catch(e => {
                    console.error("Не удалось возобновить воспроизведение:", e);
                });
            }
            
            // Если есть видеотреки, но видео не видно
            if (videoTracks.length > 0 && videoTracks[0].muted) {
                console.warn("Видеотрек заглушен, пытаемся включить");
                videoTracks[0].enabled = true;
            }
            
            // Если есть аудиотреки, но звука нет
            if (audioTracks.length > 0 && audioTracks[0].muted) {
                console.warn("Аудиотрек заглушен, пытаемся включить");
                audioTracks[0].enabled = true;
            }
        } else {
            console.warn("Нет медиапотока в элементе видео");
        }
        
    } else {
        console.log("Нет активного соединения для диагностики");
    }
    
    return false;
}

// Обработчики событий
document.addEventListener('DOMContentLoaded', function() {
    requestPermissions();
    initializePeer();
    setupVideo();

    // Инициализируем вкладки напрямую (без использования функции, которая может не исполниться)
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    if (tabButtons.length > 0) {
        console.log("Инициализация вкладок, найдено:", tabButtons.length);
        
        // Деактивируем все вкладки сначала
        tabContents.forEach(content => {
            content.style.display = 'none';
        });
        
        // Показываем первую вкладку по умолчанию
        const firstTabId = tabButtons[0].getAttribute('data-tab');
        document.querySelector(`.tab-content[data-tab="${firstTabId}"]`).style.display = 'block';
        
        // Добавляем обработчики для кнопок вкладок
        tabButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log("Клик по вкладке:", button.getAttribute('data-tab'));
                
                // Деактивируем все вкладки
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.style.display = 'none');
                
                // Активируем выбранную вкладку
                const tabId = button.getAttribute('data-tab');
                button.classList.add('active');
                document.querySelector(`.tab-content[data-tab="${tabId}"]`).style.display = 'block';
            });
        });
    } else {
        console.error("Не найдены кнопки вкладок!");
    }

    // Периодическая проверка воспроизведения видео
    setInterval(checkAndRestoreVideoPlayback, 5000);
    
    // Периодическая диагностика соединения
    setInterval(diagnoseAndFixConnection, 10000);

    // Подключение к пиру - добавляем явный обработчик события с проверкой
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', function() {
            const peerId = document.getElementById('connect-to-id').value;
            connectToPeer(peerId);
        });
    } else {
        console.error("Не найдена кнопка подключения!");
    }

    // Добавляем кнопку для изменения ID
    const changeIdBtn = document.getElementById('change-id');
    if (changeIdBtn) {
        changeIdBtn.addEventListener('click', changeUserId);
    }
    
    // Добавляем кнопку для создания группового чата
    const createGroupBtn = document.getElementById('create-group');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', createGroupChat);
    }
    
    // Кнопка разрыва соединения
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', closeCurrentConnection);
    }
    
    // Кнопка добавления текущего контакта
    const addCurrentContactBtn = document.getElementById('add-current-contact');
    if (addCurrentContactBtn) {
        addCurrentContactBtn.addEventListener('click', function() {
            if (conn) {
                const name = prompt('Введите имя для контакта:', conn.peer);
                if (name) {
                    addContact(conn.peer, name);
                }
            } else {
                showNotification('Нет активного соединения');
            }
        });
    }

    // Кнопка переключения статуса
    const statusToggleBtn = document.getElementById('status-toggle');
    if (statusToggleBtn) {
        statusToggleBtn.addEventListener('click', toggleUserStatus);
    }

    // Добавляем обработчик клика по видео для возобновления воспроизведения
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
        remoteVideo.addEventListener('click', function() {
            if (remoteVideo.paused && remoteVideo.srcObject) {
                console.log("Попытка возобновить воспроизведение видео после клика");
                remoteVideo.play().catch(e => {
                    console.error("Не удалось возобновить воспроизведение:", e);
                });
            }
        });
    }
    
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
        localVideo.addEventListener('click', function() {
            if (localVideo.paused && localVideo.srcObject) {
                console.log("Попытка возобновить воспроизведение локального видео после клика");
                localVideo.play().catch(e => {
                    console.error("Не удалось возобновить воспроизведение:", e);
                });
            }
        });
    }

    // Обработчик события изменения состояния полноэкранного режима
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('mozfullscreenchange', updateFullscreenButton);
    document.addEventListener('MSFullscreenChange', updateFullscreenButton);
    
    function updateFullscreenButton() {
        const isFullscreen = document.fullscreenElement || 
                             document.webkitFullscreenElement || 
                             document.mozFullScreenElement ||
                             document.msFullscreenElement;
        
        const fullscreenBtn = document.getElementById('fullscreen-toggle');
        if (fullscreenBtn) {
            fullscreenBtn.innerHTML = isFullscreen ? 
                '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
        }
    }

    // Отправка сообщения
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    
    // Мобильное меню
    const openSidebarBtn = document.getElementById('open-sidebar');
    if (openSidebarBtn) {
        openSidebarBtn.addEventListener('click', function() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.add('open');
            }
        });
    }
    
    const closeSidebarBtn = document.getElementById('close-sidebar');
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', function() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.remove('open');
            }
        });
    }
    
    // Добавляем обработчик клика вне сайдбара для его закрытия на мобильных
    document.addEventListener('click', function(e) {
        const sidebar = document.getElementById('sidebar');
        const openSidebarBtn = document.getElementById('open-sidebar');
        
        // Если клик был вне сайдбара и не на кнопке открытия сайдбара
        if (window.innerWidth <= 768 && 
            sidebar && sidebar.classList.contains('open') && 
            !sidebar.contains(e.target) && 
            e.target !== openSidebarBtn) {
            sidebar.classList.remove('open');
        }
    });
    
    // Управление камерой и микрофоном - убедитесь, что элементы существуют
    const toggleVideoBtn = document.getElementById('toggle-video');
    if (toggleVideoBtn) {
        toggleVideoBtn.addEventListener('click', toggleVideo);
    }
    
    const toggleCameraBtn = document.getElementById('toggle-camera');
    if (toggleCameraBtn) {
        toggleCameraBtn.addEventListener('click', toggleVideo);
    }
    
    const toggleAudioBtn = document.getElementById('toggle-audio');
    if (toggleAudioBtn) {
        toggleAudioBtn.addEventListener('click', toggleAudio);
    }
    
    const toggleMicBtn = document.getElementById('toggle-mic');
    if (toggleMicBtn) {
        toggleMicBtn.addEventListener('click', toggleAudio);
    }
    
    // Переключение камеры
    const switchCamBtn = document.getElementById('switch-cam');
    if (switchCamBtn) {
        switchCamBtn.addEventListener('click', switchCamera);
    }
    
    const switchCameraBtn = document.getElementById('switch-camera');
    if (switchCameraBtn) {
        switchCameraBtn.addEventListener('click', switchCamera);
    }
    
    // Снимок экрана
    const takeSnapshotBtn = document.getElementById('take-snapshot');
    if (takeSnapshotBtn) {
        takeSnapshotBtn.addEventListener('click', takeSnapshot);
    }
    
    // Диагностика соединения
    const restartConnectionBtn = document.getElementById('restart-connection');
    if (restartConnectionBtn) {
        restartConnectionBtn.addEventListener('click', function() {
            showNotification('Запуск диагностики и восстановления соединения...');
            diagnoseAndFixConnection();
        });
    }
    
    // Копирование ID
    const copyIdBtn = document.getElementById('copy-id');
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', copyPeerId);
    }
    
    // Полноэкранный режим
    const fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
    if (fullscreenToggleBtn) {
        fullscreenToggleBtn.addEventListener('click', toggleFullscreen);
    }
    
    // Прикрепление файла
    const attachFileBtn = document.getElementById('attach-file');
    if (attachFileBtn) {
        attachFileBtn.addEventListener('click', shareFile);
    }
    
    const shareFileBtn = document.getElementById('share-file');
    if (shareFileBtn) {
        shareFileBtn.addEventListener('click', shareFile);
    }
    
    // Загружаем контакты
    loadContacts();
});

// Функции для системы контактов и управления подключениями

// Загрузка контактов из localStorage
function loadContacts() {
    const savedContacts = localStorage.getItem('p2pContacts');
    if (savedContacts) {
        contacts = JSON.parse(savedContacts);
        console.log("Загружены контакты:", contacts.length);
        updateContactsList();
    }
}

// Сохранение контактов в localStorage
function saveContacts() {
    localStorage.setItem('p2pContacts', JSON.stringify(contacts));
}

// Добавление контакта
function addContact(peerId, name = '') {
    // Проверяем, что контакт еще не добавлен
    if (!contacts.some(contact => contact.peerId === peerId)) {
        contacts.push({
            peerId: peerId,
            name: name || peerId,
            lastSeen: new Date().toISOString(),
            messages: []
        });
        saveContacts();
        updateContactsList();
        showNotification(`Контакт ${name || peerId} добавлен`);
    } else {
        showNotification('Этот контакт уже добавлен');
    }
}

// Удаление контакта
function removeContact(peerId) {
    contacts = contacts.filter(contact => contact.peerId !== peerId);
    saveContacts();
    updateContactsList();
    showNotification('Контакт удален');
}

// Обновление списка контактов в UI
function updateContactsList() {
    const contactsListEl = document.getElementById('contacts-list');
    if (!contactsListEl) return;
    
    contactsListEl.innerHTML = '';
    
    if (contacts.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-contacts';
        emptyMsg.textContent = 'У вас пока нет контактов';
        contactsListEl.appendChild(emptyMsg);
        return;
    }
    
    contacts.forEach(contact => {
        const contactEl = document.createElement('div');
        contactEl.className = 'contact-item';
        
        const nameEl = document.createElement('div');
        nameEl.className = 'contact-name';
        nameEl.textContent = contact.name;
        
        const actionsEl = document.createElement('div');
        actionsEl.className = 'contact-actions';
        
        const callBtn = document.createElement('button');
        callBtn.className = 'icon-button';
        callBtn.innerHTML = '<i class="fas fa-phone"></i>';
        callBtn.title = 'Позвонить';
        callBtn.onclick = () => initiateConnection(contact.peerId);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-button';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Удалить';
        deleteBtn.onclick = () => {
            if (confirm(`Удалить контакт ${contact.name}?`)) {
                removeContact(contact.peerId);
            }
        };
        
        actionsEl.appendChild(callBtn);
        actionsEl.appendChild(deleteBtn);
        
        contactEl.appendChild(nameEl);
        contactEl.appendChild(actionsEl);
        
        contactsListEl.appendChild(contactEl);
    });
}

// Переключение статуса пользователя
function toggleUserStatus() {
    if (userStatus === 'available') {
        setUserStatus('away');
    } else if (userStatus === 'away') {
        setUserStatus('available');
    } else {
        // Если занят, нельзя менять статус
        showNotification('Нельзя изменить статус во время активного соединения');
    }
}