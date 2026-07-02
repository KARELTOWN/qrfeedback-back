#!/usr/bin/env bash
# A executer une fois sur le VPS, avec un utilisateur ayant sudo + docker.
set -euo pipefail

sudo mkdir -p /opt/qrfeedback/back /opt/qrfeedback/front
sudo chown -R "$USER":"$USER" /opt/qrfeedback

ssh-keygen -t ed25519 -f ~/.ssh/qrfeedback_deploy -N "" -C "github-actions-qrfeedback-deploy"
cat ~/.ssh/qrfeedback_deploy.pub >> ~/.ssh/authorized_keys
echo ">>> Ajoute cette cle privee en base64 dans le secret GitHub VPS_SSH_KEY des deux repos :"
base64 -w 0 ~/.ssh/qrfeedback_deploy
echo ""

sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

sudo ufw allow OpenSSH || true
sudo ufw allow 'Nginx Full' || true

echo ""
echo ">>> Etapes manuelles restantes :"
echo "1. Copier infra/docker-compose.yml -> /opt/qrfeedback/docker-compose.yml"
echo "2. Creer /opt/qrfeedback/.env depuis infra/env.compose.example"
echo "3. Creer /opt/qrfeedback/back/.env depuis infra/env.back.production.example"
echo "4. Creer /opt/qrfeedback/front/.env.production depuis infra/env.front.production.example"
echo "5. Copier infra/nginx/*.conf vers /etc/nginx/sites-available/"
echo "6. Activer les sites avec ln -s, puis nginx -t && systemctl reload nginx"
echo "7. Verifier les DNS, puis lancer certbot pour le domaine front et le sous-domaine API"
