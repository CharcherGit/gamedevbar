import { Config } from './Config';
import { Scene } from '../rendering/Scene';
import { Renderer } from '../rendering/Renderer';
import { Camera } from '../rendering/Camera';
import { WebSocketManager } from '@network/WebSocketManager';
import { PlayerManager } from '../entities/PlayerManager';
import { Environment } from '../world/Environment';
import { ChatUI } from '../ui/ChatUI';
import { ModelSelector } from '../ui/ModelSelector';
import * as THREE from 'three';
import { World } from '../world/World';

export class Game {
    constructor() {
        // Asignar la instancia del juego a window.game primero
        window.game = this;

        this.config = new Config();
        this.scene = new Scene();
        this.camera = new Camera(this.scene.getScene());
        this.renderer = new Renderer(this.scene, this.camera);
        this.world = new World(this.scene);
        this.environment = new Environment(this.scene, this.world);
        
        // Inicializar UI antes que network
        this.ui = {
            chat: new ChatUI(),
            modelSelector: new ModelSelector()
        };

        // Inicializar network después de UI
        this.network = new WebSocketManager();
        this.players = new PlayerManager(this);

        this.ui.modelSelector.init();
        this.setupInitialUI();
        this.clock = new THREE.Clock();
    }

    setupInitialUI() {
        const usernameDialog = document.getElementById('username-dialog');
        const usernameInput = document.getElementById('username-input');
        const startButton = document.getElementById('start-button');
        const chatInput = document.getElementById('chat-input');
        const chatBox = document.getElementById('chat-box');
        const chatContainer = document.getElementById('chat-container');

        if (!startButton || !usernameInput || !usernameDialog) {
            console.error('Required UI elements not found');
            return;
        }

        startButton.addEventListener('click', async () => {
            const username = usernameInput.value.trim();
            if (username) {
                // Esperar a que se seleccione un modelo antes de continuar
                const selectedModel = await this.ui.modelSelector.waitForModelSelection();
                console.log('Selected model before starting game:', selectedModel);
                
                this.username = username;
                usernameDialog.classList.add('hidden');
                if (chatContainer) chatContainer.classList.remove('hidden');
                if (chatBox) chatBox.classList.remove('hidden');

                await this.init();
                this.setupEventListeners();
                this.animate();

                if (this.environment?.radio) {
                    this.environment.radio.initializeAudio();
                }
            }
        });

        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !startButton.disabled) {
                startButton.click();
            }
        });
    }

    async init() {
        this.renderer.init();
        await this.scene.waitForLoad();
        this.network.connect();
        this.world.create();
        this.environment.create();
        this.ui.modelSelector.init();
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.handleResize());

        // Manejo de mouse y raycasting
        window.addEventListener('mousemove', (e) => {
            this.mouse = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );
            this.handleMouseMove(e);
        });

        window.addEventListener('click', (e) => this.handleClick(e));
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        // Prevenir comportamiento por defecto en el chat
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.addEventListener('focus', () => {
                this.chatActive = true;
            });
            chatInput.addEventListener('blur', () => {
                this.chatActive = false;
            });
        }
    }

    handleMouseMove(event) {
        if (this.chatActive) return;

        this.raycaster = this.raycaster || new THREE.Raycaster();
        this.raycaster.setFromCamera(this.mouse, this.camera.getCamera());
        const intersects = this.raycaster.intersectObjects(this.scene.getScene().children, true);

        // Restaurar highlight anterior
        if (this.highlightedObject) {
            if (this.highlightedObject.userData?.type === "seat") {
                this.highlightedObject.traverse((child) => {
                    if (child.isMesh && child.userData.originalMaterial) {
                        child.material = child.userData.originalMaterial;
                    }
                });
            } else if (this.highlightedObject.userData?.type === "radio") {
                const body = this.highlightedObject.children[0];
                body.material = this.highlightedObject.userData.originalMaterial;
                this.highlightedObject.scale.set(1, 1, 1);
            }
        }

        this.highlightedObject = null;

        // Buscar nuevo objeto para highlight
        for (const intersect of intersects) {
            const object = intersect.object.parent;
            
            if (object.userData?.type === "seat" || object.userData?.type === "radio") {
                this.highlightedObject = object;
                if (object.userData.type === "seat") {
                    object.traverse((child) => {
                        if (child.isMesh && child.userData.highlightMaterial) {
                            child.material = child.userData.highlightMaterial;
                        }
                    });
                } else if (object.userData.type === "radio") {
                    const body = object.children[0];
                    body.material = object.userData.highlightMaterial;
                    object.scale.set(1.1, 1.1, 1.1);
                }
                break;
            }
        }
    }

    handleClick(event) {
        if (this.chatActive) return;

        // Verificar si el click fue en elementos de UI
        const chatElements = ['chat-box', 'chat-input', 'emotes-panel'].map(
            id => document.getElementById(id)
        );

        const clickedElement = document.elementFromPoint(event.clientX, event.clientY);
        if (chatElements.some(el => el && el.contains(clickedElement))) {
            return;
        }

        // Procesar interacciones con objetos 3D
        if (this.highlightedObject) {
            if (this.highlightedObject.userData.type === "radio") {
                const radioGroup = this.highlightedObject;
                const sound = radioGroup.userData.sound;
                const indicator = radioGroup.userData.indicator;

                if (radioGroup.userData.isPlaying) {
                    sound.pause();
                    indicator.material.emissive.setHex(0x696969);
                    indicator.material.color.setHex(0x696969);
                    indicator.material.emissiveIntensity = 0.1;
                } else {
                    sound.play();
                    indicator.material.emissive.setHex(radioGroup.userData.originalIndicatorColor);
                    indicator.material.color.setHex(radioGroup.userData.originalIndicatorColor);
                    indicator.material.emissiveIntensity = 0.5;
                }
                radioGroup.userData.isPlaying = !radioGroup.userData.isPlaying;
            } else if (this.highlightedObject.userData.type === "seat") {
                // Manejar interacción con asientos
                if (this.players.localPlayer) {
                    if (!this.players.localPlayer.isSitting) {
                        this.players.localPlayer.sitDown(this.highlightedObject);
                    }
                }
            }
        }
    }

    handleResize() {
        this.camera.updateAspect(window.innerWidth / window.innerHeight);
        this.renderer.updateSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();
        this.update(deltaTime);
        this.render();
    }

    update(deltaTime) {
        this.players.update(deltaTime);
        this.world.update(deltaTime);

        // Actualizar posición de la cámara para seguir al jugador local
        if (this.players.localPlayer) {
            this.camera.updatePosition(this.players.localPlayer.mesh.position);
        }
    }

    render() {
        this.renderer.render();
    }
}