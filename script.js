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

// Инициализация PeerJS
function initializePeer() {
    peer = new Peer({
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });
    
    peer.on('open', (id) => {
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
    showNotification('Входящий видеозвонок...');
    
    if (currentCall) {
        call.close();
        return;
    }
    
    currentCall = call;
    
    // Отвечаем на звонок с нашим видеопотоком
    call.answer(localStream);
    
    call.on('stream', (remoteStream) => {
        const remoteVideo = document.getElementById('remote-video');
        remoteVideo.srcObject = remoteStream;
        
        // Проверяем наличие видеотрека
        remoteVideo.onloadedmetadata = () => {
            const hasVideoTracks = remoteStream.getVideoTracks().length > 0;
            const videoBox = document.querySelector('.video-box:nth-child(2)');
            
            if (hasVideoTracks) {
                videoBox.style.backgroundColor = "#000";
                showNotification('Видеосвязь установлена');
            } else {
                videoBox.style.backgroundColor = "#333";
                showNotification('Установлена только аудиосвязь');
            }
        };
        
        // Обработка ошибок видеопотока
        remoteVideo.onerror = (err) => {
            console.error('Ошибка видеопотока:', err);
            showNotification('Ошибка видеопотока');
        };
    });
    
    call.on('close', () => {
        document.getElementById('remote-video').srcObject = null;
        currentCall = null;
        showNotification('Звонок завершен');
    });
    
    call.on('error', (err) => {
        console.error('Ошибка звонка:', err);
        showNotification('Ошибка видеосвязи');
    });
}

// Настройка видеопотока
async function setupVideo() {
    try {
        // Сначала пробуем получить видео и аудио
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode },
            audio: true
        });
        
        // Проверяем наличие видеотрека
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = true;
        }
        
        document.getElementById('local-video').srcObject = localStream;
        return true;
    } catch (err) {
        console.error('Ошибка доступа к камере:', err);
        
        // Пробуем получить только аудио
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });
            document.getElementById('local-video').srcObject = localStream;
            showNotification('Доступен только микрофон');
            return true;
        } catch (audioErr) {
            console.error('Ошибка доступа к микрофону:', audioErr);
            
            // Создаем пустой поток для возможности приема видео
            localStream = new MediaStream();
            showNotification('Вы сможете видеть и слышать собеседника, но он вас - нет');
            return true;
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
    const video = document.getElementById('remote-video');
    const canvas = document.createElement('canvas');
    
    // Если нет видеопотока, берем локальный
    if (!video.srcObject) {
        video = document.getElementById('local-video');
    }
    
    if (!video.srcObject) {
        showNotification('Нет видеопотока для скриншота');
        return;
    }
    
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
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
        document.getElementById('connection-status').textContent = 'Подключение...';
        
        // Создаем соединение для данных
        conn = peer.connect(peerId, {
            reliable: true
        });
        
        conn.on('open', function() {
            setupConnection();
            document.getElementById('connection-status').textContent = 'Подключен';
            document.getElementById('connection-status').style.color = 'green';
            document.getElementById('remote-name').textContent = peerId;
            
            // Инициируем видеозвонок
            if (localStream) {
                currentCall = peer.call(peerId, localStream);
                
                currentCall.on('stream', (remoteStream) => {
                    const remoteVideo = document.getElementById('remote-video');
                    remoteVideo.srcObject = remoteStream;
                    
                    remoteVideo.onloadedmetadata = () => {
                        const hasVideoTracks = remoteStream.getVideoTracks().length > 0;
                        const videoBox = document.querySelector('.video-box:nth-child(2)');
                        
                        if (hasVideoTracks) {
                            videoBox.style.backgroundColor = "#000";
                            showNotification('Видеосвязь установлена');
                        } else {
                            videoBox.style.backgroundColor = "#333";
                            showNotification('Установлена только аудиосвязь');
                        }
                    };
                    
                    remoteVideo.onerror = (err) => {
                        console.error('Ошибка видеопотока:', err);
                        showNotification('Ошибка видеопотока');
                    };
                });
                
                currentCall.on('close', () => {
                    document.getElementById('remote-video').srcObject = null;
                    currentCall = null;
                    showNotification('Звонок завершен');
                });
                
                currentCall.on('error', (err) => {
                    console.error('Ошибка видеосвязи:', err);
                    showNotification('Ошибка видеосвязи');
                });
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
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            showNotification('Не удалось войти в полноэкранный режим');
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Обработчики событий
document.addEventListener('DOMContentLoaded', () => {
    requestPermissions();
    initializePeer();
    setupVideo();

    // Подключение к пиру
    document.getElementById('connect-btn').addEventListener('click', () => {
        const peerId = document.getElementById('connect-to-id').value;
        connectToPeer(peerId);
        // Закрываем боковое меню после нажатия на кнопку подключения на мобильных
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('open');
        }
    });

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