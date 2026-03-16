"""
Email Service for sending contact form emails

Configuration:
For Google Workspace:
- SMTP_USERNAME: your full email address
- SMTP_PASSWORD: App Password from Google Account (not your regular password)
  To create an App Password:
  1. Go to your Google Account settings
  2. Security > 2-Step Verification > App passwords
  3. Generate a new app password for "Mail"
  4. Use that 16-character password here

Environment variables:
- SMTP_SERVER (default: smtp.gmail.com)
- SMTP_PORT (default: 587)
- SMTP_USERNAME (default: noreply@example.com)
- SMTP_PASSWORD (required - your Google App Password)
- FROM_EMAIL (default: noreply@example.com)
- CONTACT_EMAIL (default: contact@example.com)
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via SMTP"""
    
    def __init__(self):
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username = os.getenv("SMTP_USERNAME", "noreply@example.com")
        # Password should be an App Password, not your regular password
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.from_email = os.getenv("FROM_EMAIL", "noreply@example.com")
        self.to_email = os.getenv("CONTACT_EMAIL", "contact@example.com")
        
    def send_contact_email(
        self,
        name: str,
        organization: str,
        title: str,
        email: str,
        message: Optional[str] = None
    ) -> bool:
        """
        Send contact form submission email
        
        Args:
            name: Contact's name
            organization: Contact's organization
            title: Contact's job title
            email: Contact's email
            message: Optional message
            
        Returns:
            True if email sent successfully, False otherwise
        """
        try:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = self.from_email
            msg['To'] = self.to_email
            msg['Subject'] = f"Contact Form Submission from {name}"
            msg['Reply-To'] = email
            
            # Create email body
            body = f"""
New contact form submission:

Name: {name}
Organization: {organization}
Title: {title}
Email: {email}
Message: {message or '(No message provided)'}

---
This email was sent from the Process Mapper Core contact form.
Reply directly to this email to respond to {name} ({email}).
"""
            
            msg.attach(MIMEText(body, 'plain'))
            
            # Send email
            if not self.smtp_username or not self.smtp_password:
                logger.warning("SMTP credentials not configured. Email not sent.")
                return False
                
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_username, self.smtp_password)
                server.send_message(msg)
                
            return True
            
        except Exception as e:
            logger.error(f"Error sending contact email: {str(e)}")
            return False

