#!/usr/bin/env bash
# One-time server setup (Ubuntu/Debian, run as root):
#   git clone git@github.com:mulubbad/YMCReport.git /tmp/ymc && bash /tmp/ymc/deploy/setup.sh
# Before running: put your cert at /etc/ssl/ymcteam/{fullchain.pem,privkey.pem}
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; }
apt-get install -y nginx rsync nodejs build-essential python3

mkdir -p /var/www/ymcteam /opt/ymcreport/server /var/lib/ymcreport
[ -f /etc/ymcreport.env ] || { echo "JWT_SECRET=$(openssl rand -hex 32)" > /etc/ymcreport.env; chmod 600 /etc/ymcreport.env; }
# FCM push: drop the Firebase service-account JSON at this path (console → Project settings → Service accounts)
grep -q FIREBASE_SERVICE_ACCOUNT /etc/ymcreport.env || echo "FIREBASE_SERVICE_ACCOUNT=/etc/ymcreport-firebase.json" >> /etc/ymcreport.env

cp ymcreport.service /etc/systemd/system/ymcreport.service
systemctl daemon-reload && systemctl enable ymcreport

cp nginx.conf /etc/nginx/sites-available/ymcteam
ln -sf /etc/nginx/sites-available/ymcteam /etc/nginx/sites-enabled/ymcteam
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# deploy key for GitHub Actions
[ -f /root/.ssh/ymc_deploy ] || ssh-keygen -t ed25519 -N '' -f /root/.ssh/ymc_deploy -C github-actions
grep -qf /root/.ssh/ymc_deploy.pub /root/.ssh/authorized_keys 2>/dev/null || cat /root/.ssh/ymc_deploy.pub >> /root/.ssh/authorized_keys

echo; echo "Done. Add GitHub secrets:"
echo "  SSH_HOST = $(curl -s ifconfig.me || hostname -I | awk '{print $1}')"
echo "  SSH_KEY  = contents of /root/.ssh/ymc_deploy  (private key, shown below)"
echo "  VITE_FIREBASE_VAPID_KEY = Firebase console → Cloud Messaging → Web Push certificates"
echo "Then copy the Firebase service-account JSON to /etc/ymcreport-firebase.json (chmod 600) and restart ymcreport."; echo
cat /root/.ssh/ymc_deploy
