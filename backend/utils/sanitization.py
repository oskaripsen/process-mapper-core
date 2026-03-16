import bleach

def sanitize_text(text: str) -> str:
    """
    Sanitize text to prevent XSS.
    Allows a safe subset of HTML tags and attributes.
    """
    if not text:
        return text
        
    allowed_tags = [
        'b', 'i', 'u', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
    ]
    allowed_attributes = {
        'a': ['href', 'title', 'target']
    }
    
    return bleach.clean(text, tags=allowed_tags, attributes=allowed_attributes, strip=True)
