# Conway's Time Machine (Game of Life WebUI)

A feature-rich, highly interactive implementation of **Conway's Game of Life**, styled with the **Nord** color palette.

Unlike standard implementations, this engine features a **history buffer**, allowing you to "rewind time" and correct mistakes or analyze patterns in reverse.

![Nord Theme](https://github.com/arcticicestudio/nord/raw/develop/assets/nord-banner-wide.png)

## Features

*   **Time Travel**: Circular history buffer allows you to step backward in time (`Step -`).
*   **Tools**: Draw, Erase, and Paste common patterns (Gliders, Pulsars, Gosper Guns, etc.).
*   **Control**: Adjustable speed (FPS), single-step forward/backward, pause/resume.
*   **Persistence**: Save and load your custom patterns using browser LocalStorage.
*   **Aesthetics**: Minimalist UI using the Nord color scheme.

## Usage

### 🐳 Using Docker (Recommended)

The project includes a Docker setup for easy deployment.

1.  **Start the container:**
    ```bash
    docker compose up -d
    ```

2.  **Access the application:**
    Open your browser and navigate to `http://localhost:8088`.

3.  **Development:**
    The `docker-compose.yml` mounts the local `./public` directory, so changes to `index.html`, `style.css`, or `script.js` are reflected immediately upon refresh.

### 📦 Local / No Docker

Since this is a static web application, you don't strictly need Docker.

*   **Option 1**: Open `public/index.html` directly in your browser.
*   **Option 2** (Python):
    ```bash
    cd public
    python3 -m http.server 8088
    ```

## Key Controls

*   **Left Click**: Draw cells / Paste pattern.
*   **Playback**: Use the sidebar buttons to control the simulation.
*   **Keyboard**:
    *   Currently, controls are UI-only.

## Tech Stack

*   **Frontend**: Vanilla HTML5, CSS3 (Variables), JavaScript (ES6+).
*   **Rendering**: HTML5 Canvas API for high-performance rendering.
*   **Infrastructure**: Nginx (Alpine) via Docker.
