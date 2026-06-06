importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDc46TCa2wL0K2IhXLF22Q4zvlpcidA_Oc",
  authDomain: "gurogu-market.firebaseapp.com",
  projectId: "gurogu-market",
  storageBucket: "gurogu-market.firebasestorage.app",
  messagingSenderId: "999150276391",
  appId: "1:999150276391:web:59a86f1a0f6d63cbb72302"
});

const messaging = firebase.messaging();

// 백그라운드 푸시 수신 (앱이 닫혀있을 때)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '구로구마켓';
  const options = {
    body: payload.notification?.body || '',
    icon: '/gurogu-market-logo.png',
    badge: '/gurogu-market-logo.png',
    data: payload.data || {},
  };
  return self.registration.showNotification(title, options);
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
