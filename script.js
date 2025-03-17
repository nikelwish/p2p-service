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
        document.getElementById('connection-status').textContent = 'Готов к подключению';
        document.getElementById('connection-status').style.color = 'green';
    });

    peer.on('connection', handleConnection);

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

// Обработка входящего соединения
function handleConnection(connection) {
    if (conn) {
        // Закрываем предыдущее соединение
        conn.close();
    }
    
    conn = connection;
    showNotification('Соединение установлено с ' + conn.peer);
    document.getElementById('connection-status').textContent = 'Подключен';
    document.getElementById('connection-status').style.color = 'green';
    document.getElementById('remote-name').textContent = conn.peer;
    
    setupConnection();
}

// Обработка входящего видеозвонка
function handleIncomingCall(call) {
    console.log("Входящий звонок от:", call.peer, "с метаданными:", call.metadata);
    showNotification('Входящий видеозвонок...');
    
    if (currentCall) {
        console.log("Уже есть активный звонок, отклоняем");
        call.close();
        return;
    }
    
    currentCall = call;
    
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
        conn = null;
        document.getElementById('connection-status').textContent = 'Соединение закрыто';
        document.getElementById('connection-status').style.color = 'red';
        document.getElementById('remote-video').srcObject = null;
        showNotification('Соединение закрыто');
    });
}

// Подключение к другому пиру
function connectToPeer(peerId) {
    if (!peerId) {
        showNotification('Введите ID собеседника');
        return;
    }

    try {
        console.log("Подключаемся к:", peerId);
        document.getElementById('connection-status').textContent = 'Подключение...';
        
        // Создаем соединение для данных
        conn = peer.connect(peerId, {
            reliable: true,
            serialization: 'json' // используем json для более стабильной передачи
        });
        
        conn.on('open', function() {
            console.log("Соединение установлено");
            setupConnection();
            document.getElementById('connection-status').textContent = 'Подключен';
            document.getElementById('connection-status').style.color = 'green';
            document.getElementById('remote-name').textContent = peerId;
            
            // Инициируем видеозвонок
            if (localStream) {
                console.log("Инициируем видеозвонок");
                
                // Настройки вызова
                const callOptions = {
                    metadata: {
                        userId: customPeerId,
                        hasVideo: localStream.getVideoTracks().length > 0,
                        hasAudio: localStream.getAudioTracks().length > 0
                    }
                };
                
                currentCall = peer.call(peerId, localStream, callOptions);
                
                if (currentCall) {
                    setupCallEvents(currentCall);
                } else {
                    console.error("Не удалось инициировать вызов");
                    showNotification('Не удалось начать видеозвонок');
                }
            } else {
                console.log("Локальный поток не доступен");
                showNotification('Локальный поток не доступен, видеосвязь не будет установлена');
            }
            
            // Закрываем боковое меню на мобильных после успешного подключения
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
        
        conn.on('error', (err) => {
            console.error('Ошибка подключения:', err);
            showNotification('Не удалось подключиться к ' + peerId);
            document.getElementById('connection-status').textContent = 'Ошибка';
            document.getElementById('connection-status').style.color = 'red';
        });
    } catch (err) {
        console.error('Ошибка при создании соединения:', err);
        showNotification('Не удалось подключиться');
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
        console.log("Видео треки отсутствуют");
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
document.addEventListener('DOMContentLoaded', () => {
    requestPermissions();
    initializePeer();
    setupVideo();

    // Периодическая проверка воспроизведения видео
    setInterval(checkAndRestoreVideoPlayback, 5000);
    
    // Периодическая диагностика соединения
    setInterval(diagnoseAndFixConnection, 10000);

    // Подключение к пиру
    document.getElementById('connect-btn').addEventListener('click', () => {
        const peerId = document.getElementById('connect-to-id').value;
        connectToPeer(peerId);
        // Закрываем боковое меню после нажатия на кнопку подключения на мобильных
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    });

    // Добавляем кнопку для изменения ID
    document.getElementById('change-id').addEventListener('click', changeUserId);

    // Добавляем обработчик клика по видео для возобновления воспроизведения
    document.getElementById('remote-video').addEventListener('click', () => {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo.paused && remoteVideo.srcObject) {
            console.log("Попытка возобновить воспроизведение видео после клика");
            remoteVideo.play().catch(e => {
                console.error("Не удалось возобновить воспроизведение:", e);
            });
        }
    });
    
    document.getElementById('local-video').addEventListener('click', () => {
        const localVideo = document.getElementById('local-video');
        if (localVideo.paused && localVideo.srcObject) {
            console.log("Попытка возобновить воспроизведение локального видео после клика");
            localVideo.play().catch(e => {
                console.error("Не удалось возобновить воспроизведение:", e);
            });
        }
    });

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
        
        document.getElementById('fullscreen-toggle').innerHTML = isFullscreen ? 
            '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    }

    // Отправка сообщения
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // Мобильное меню
    document.getElementById('open-sidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('open');
    });
    
    document.getElementById('close-sidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
    });
    
    // Добавляем обработчик клика вне сайдбара для его закрытия на мобильных
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const openSidebarBtn = document.getElementById('open-sidebar');
        
        // Если клик был вне сайдбара и не на кнопке открытия сайдбара
        if (window.innerWidth <= 768 && 
            sidebar.classList.contains('open') && 
            !sidebar.contains(e.target) && 
            e.target !== openSidebarBtn) {
            sidebar.classList.remove('open');
        }
    });
    
    // Управление камерой и микрофоном
    document.getElementById('toggle-video').addEventListener('click', toggleVideo);
    document.getElementById('toggle-camera').addEventListener('click', toggleVideo);
    document.getElementById('toggle-audio').addEventListener('click', toggleAudio);
    document.getElementById('toggle-mic').addEventListener('click', toggleAudio);
    
    // Переключение камеры
    document.getElementById('switch-cam').addEventListener('click', switchCamera);
    document.getElementById('switch-camera').addEventListener('click', switchCamera);
    
    // Снимок экрана
    document.getElementById('take-snapshot').addEventListener('click', takeSnapshot);
    
    // Диагностика соединения
    document.getElementById('restart-connection').addEventListener('click', function() {
        showNotification('Запуск диагностики и восстановления соединения...');
        diagnoseAndFixConnection();
    });
    
    // Копирование ID
    document.getElementById('copy-id').addEventListener('click', copyPeerId);
    
    // Полноэкранный режим
    document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullscreen);
    
    // Прикрепление файла
    document.getElementById('attach-file').addEventListener('click', shareFile);
    document.getElementById('share-file').addEventListener('click', shareFile);
});

// Отправка сообщения
function sendMessage() {
    // Если есть ожидающий файл, отправляем его
    if (pendingFile) {
        sendFile(pendingFile);
        document.getElementById('file-preview').style.display = 'none';
        pendingFile = null;
        return;
    }
    
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (message && conn) {
        conn.send(message);
        addMessage(message, true);
        input.value = '';
    } else if (!conn) {
        showNotification('Нет активного соединения');
    }
} 