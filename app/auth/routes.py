from datetime import datetime, timezone
from flask import render_template, redirect, url_for, flash, request, current_app
from flask_login import login_user, logout_user, login_required, current_user
from flask_mail import Message
from app import db, mail
from app.auth import bp
from app.models import User


# ── Setup (first run) ────────────────────────────────────────────────────────

@bp.route('/setup', methods=['GET', 'POST'])
def setup():
    if User.query.count() > 0:
        return redirect(url_for('auth.login'))

    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        password2 = request.form.get('password2', '')

        errors = _validate_registration(name, email, password, password2)
        if errors:
            for e in errors:
                flash(e, 'error')
            return render_template('auth/setup.html', name=name, email=email)

        user = User(email=email, display_name=name, is_admin=True)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        flash('Admin-Konto erstellt. Bitte jetzt anmelden.', 'success')
        return redirect(url_for('auth.login'))

    return render_template('auth/setup.html', name='', email='')


# ── Login / Logout ────────────────────────────────────────────────────────────

@bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if User.query.count() == 0:
        return redirect(url_for('auth.setup'))

    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        remember = bool(request.form.get('remember'))

        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            user.last_login = datetime.now(timezone.utc)
            db.session.commit()
            login_user(user, remember=remember)
            next_page = request.args.get('next')
            return redirect(next_page or url_for('main.index'))

        flash('E-Mail oder Passwort falsch.', 'error')

    return render_template('auth/login.html')


@bp.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Erfolgreich abgemeldet.', 'success')
    return redirect(url_for('auth.login'))


# ── Password Reset ────────────────────────────────────────────────────────────

@bp.route('/reset-request', methods=['GET', 'POST'])
def reset_request():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        user = User.query.filter_by(email=email).first()
        if user:
            _send_reset_email(user)
        # Always show success to prevent email enumeration
        flash(
            'Falls ein Konto mit dieser E-Mail existiert, wurde ein Reset-Link gesendet.',
            'info'
        )
        return redirect(url_for('auth.login'))

    return render_template('auth/reset_request.html')


@bp.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    expiry = int(current_app.config['PASSWORD_RESET_EXPIRY'].total_seconds())
    user = User.verify_reset_token(token, max_age_seconds=expiry)
    if user is None:
        flash('Der Reset-Link ist ungültig oder abgelaufen.', 'error')
        return redirect(url_for('auth.reset_request'))

    if request.method == 'POST':
        password = request.form.get('password', '')
        password2 = request.form.get('password2', '')

        if len(password) < 8:
            flash('Passwort muss mindestens 8 Zeichen lang sein.', 'error')
            return render_template('auth/reset_password.html', token=token)
        if password != password2:
            flash('Passwörter stimmen nicht überein.', 'error')
            return render_template('auth/reset_password.html', token=token)

        user.set_password(password)
        db.session.commit()
        flash('Passwort erfolgreich geändert. Bitte jetzt anmelden.', 'success')
        return redirect(url_for('auth.login'))

    return render_template('auth/reset_password.html', token=token)


# ── Change Password (logged in) ───────────────────────────────────────────────

@bp.route('/change-password', methods=['GET', 'POST'])
@login_required
def change_password():
    if request.method == 'POST':
        current_pw = request.form.get('current_password', '')
        new_pw = request.form.get('new_password', '')
        new_pw2 = request.form.get('new_password2', '')

        if not current_user.check_password(current_pw):
            flash('Aktuelles Passwort falsch.', 'error')
        elif len(new_pw) < 8:
            flash('Neues Passwort muss mindestens 8 Zeichen lang sein.', 'error')
        elif new_pw != new_pw2:
            flash('Neue Passwörter stimmen nicht überein.', 'error')
        else:
            current_user.set_password(new_pw)
            db.session.commit()
            flash('Passwort erfolgreich geändert.', 'success')
            return redirect(url_for('main.index'))

    return render_template('auth/change_password.html')


# ── Helpers ───────────────────────────────────────────────────────────────────

def _send_reset_email(user: User) -> None:
    token = user.get_reset_token()
    base_url = current_app.config.get('BASE_URL', request.host_url.rstrip('/'))
    reset_url = f"{base_url}{url_for('auth.reset_password', token=token)}"
    app_name = current_app.config.get('APP_NAME', 'App')

    msg = Message(
        subject=f'[{app_name}] Passwort zurücksetzen',
        recipients=[user.email],
    )
    msg.body = (
        f'Hallo {user.display_name},\n\n'
        f'du hast einen Passwort-Reset angefordert.\n\n'
        f'Klicke auf den folgenden Link (gültig für 1 Stunde):\n{reset_url}\n\n'
        f'Falls du keinen Reset angefordert hast, ignoriere diese E-Mail.\n\n'
        f'-- {app_name}'
    )
    msg.html = render_template(
        'auth/reset_email.html',
        user=user,
        reset_url=reset_url,
        app_name=app_name,
    )
    mail.send(msg)


def _validate_registration(name, email, password, password2):
    errors = []
    if not name or len(name) < 2:
        errors.append('Name muss mindestens 2 Zeichen lang sein.')
    if not email or '@' not in email:
        errors.append('Ungültige E-Mail-Adresse.')
    if len(password) < 8:
        errors.append('Passwort muss mindestens 8 Zeichen lang sein.')
    if password != password2:
        errors.append('Passwörter stimmen nicht überein.')
    return errors
