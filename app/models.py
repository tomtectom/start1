from datetime import datetime, timezone
from flask_login import UserMixin
import bcrypt
from itsdangerous import URLSafeTimedSerializer
from flask import current_app
from app import db, login_manager


class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = db.Column(db.DateTime, nullable=True)

    def set_password(self, password: str) -> None:
        self.password_hash = bcrypt.hashpw(
            password.encode('utf-8'), bcrypt.gensalt(rounds=12)
        ).decode('utf-8')

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(
            password.encode('utf-8'), self.password_hash.encode('utf-8')
        )

    def get_reset_token(self) -> str:
        s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        return s.dumps({'user_id': self.id, 'email': self.email}, salt='password-reset')

    @staticmethod
    def verify_reset_token(token: str, max_age_seconds: int = 3600):
        s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        try:
            data = s.loads(token, salt='password-reset', max_age=max_age_seconds)
        except Exception:
            return None
        return User.query.get(data.get('user_id'))

    def __repr__(self):
        return f'<User {self.email}>'


@login_manager.user_loader
def load_user(user_id: str):
    return User.query.get(int(user_id))
