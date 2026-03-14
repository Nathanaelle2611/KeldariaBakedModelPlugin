(function() {

  function compactArrays(jsonString) {
    return jsonString.replace(
      /\[\s*([\d.\-eE]+|true|false|null)(,\s*([\d.\-eE]+|true|false|null))*\s*\]/g,
      (match) => match.replace(/\s+/g, ' ').replace(/\n/g, '')
    );
  }

  // Labels des 8 vertices : [X, Y, Z] → bottom = from[1], top = to[1]
  // Ordre : [X-Z-, X+Z-, X-Z+, X+Z+] pour chaque couche
  const VERTEX_LABELS = [
    'B  NW', 'B  NE',
    'B  SW', 'B  SE',
    'T  NW', 'T  NE',
    'T  SW', 'T  SE',
  ];

  BBPlugin.register('keldaria_format', {
    title: "Keldaria BakedModel Format",
    author: "Nathanaelle2611",
    description: "Models pour Keldaria",

    onload() {

      // ── Codec ────────────────────────────────────────────────────────────
      // keldaria_shader_ids est stocké directement sur les instances Cube
      // comme propriété plain JS. parse/compile s'en chargent manuellement.
      const codec = new Codec('keldaria_baked_codec', {
        name: "Keldaria Baked Codec",
        extension: "json",

        parse(model, filePath) {
          if (!model.parts || model.elements) {
            Blockbench.showStatusMessage(
              "Ce fichier n'est pas un modèle Keldaria ('parts' manquant ou 'elements' présent).",
              4000
            );
            return;
          }

          // 1. Taille de texture
          if (Array.isArray(model.texture_size) && model.texture_size.length === 2) {
            Project.texture_width  = model.texture_size[0] || 16;
            Project.texture_height = model.texture_size[1] || 16;
          }

          // 2. Textures
          const id_to_uuid = {};
          const modelDir = filePath
            ? filePath
                .replace(/[\\/][^\\/]+$/, '')
                .replace(/[\\/][^\\/]+$/, '')
                .replace(/[\\/][^\\/]+$/, '')
            : '';

          if (model.textures && typeof model.textures === 'object') {
            for (const [texId, texRelPath] of Object.entries(model.textures)) {
              const texture = new Texture({ id: texId, name: texRelPath }).add(false);
              if (modelDir) {
                const sep = modelDir.includes('\\') ? '\\' : '/';
                const normalRelPath = texRelPath.replace(/[\\/]/g, sep);
                texture.fromPath(modelDir + sep + normalRelPath);
                texture.name = texRelPath;
              }
              id_to_uuid[texId] = texture.uuid;
            }
          }

          // 3. Parts → Cubes
          for (const part of model.parts) {
            const cube = new Cube({
              from:     part.from        || [0,  0,  0],
              to:       part.to          || [16, 16, 16],
              origin:   part.pivot_point || [8,  8,  8],
              rotation: part.rotation    || [0,  0,  0],
            });

            // Shader IDs des vertices
            if (Array.isArray(part.shader_ids) && part.shader_ids.length === 8) {
              cube.keldaria_shader_ids = part.shader_ids.map(Number);
            }

            if (part.faces && typeof part.faces === 'object') {
              for (const [faceKey, faceData] of Object.entries(part.faces)) {
                if (!cube.faces[faceKey]) continue;
                const face = cube.faces[faceKey];
                if (Array.isArray(faceData.uv))              face.uv       = faceData.uv;
                if (typeof faceData.rotation   === 'number') face.rotation = faceData.rotation;
                if (typeof faceData.tint_index === 'number') face.tint     = faceData.tint_index;
                if (typeof faceData.texture === 'string') {
                  face.texture = id_to_uuid[faceData.texture.replace(/^#/, '')] ?? null;
                }
              }
            }

            cube.init().addTo(undefined, false);
          }

          // 4. Display modes
          if (model.display && typeof model.display === 'object') {
            for (const [key, val] of Object.entries(model.display)) {
              const mode = Project.display_settings && Project.display_settings[key];
              if (!mode) continue;
              if (Array.isArray(val.rotation))    mode.rotation    = val.rotation;
              if (Array.isArray(val.translation)) mode.translation = val.translation;
              if (Array.isArray(val.scale))       mode.scale       = val.scale;
              mode.export = true;
            }
          }

          Canvas.updateAll();
          Validator.validate();
        },

        compile(options) {
          const model      = {};
          const textures   = {};
          const uuid_to_id = {};
          const parts      = [];

          Project.textures.forEach(tex => {
            textures[tex.id] = tex.name;
            uuid_to_id[tex.uuid] = tex.id;
          });

          Outliner.elements.forEach(cube => {
            const faces = {};
            for (const [faceKey, faceValue] of Object.entries(cube.faces)) {
              if (faceValue.texture !== null) {
                const faceObj = faces[faceKey] = {
                  uv:      faceValue.uv,
                  texture: "#" + uuid_to_id[faceValue.texture]
                };
                if (faceValue.rotation != 0)  faceObj.rotation   = faceValue.rotation;
                if (faceValue.tint    != -1)  faceObj.tint_index = faceValue.tint;
              }
            }

            const shaderIds = cube.keldaria_shader_ids || [0,0,0,0,0,0,0,0];

            const part = {
              from:        cube.from,
              to:          cube.to,
              pivot_point: cube.origin,
              rotation:    cube.rotation,
              faces,
            };

            // N'écrire shader_ids que si au moins un vertex n'est pas à 0
            if (shaderIds.some(v => v !== 0)) {
              part.shader_ids = shaderIds;
            }

            parts.push(part);
          });

          model.texture_size = [Project.texture_width, Project.texture_height];
          model.textures     = textures;
          model.parts        = parts;

          // Display modes — DisplayMode.slots est un tableau de noms de clés,
          // les instances réelles sont dans Project.display_settings
          const display = {};
          for (const key of DisplayMode.slots) {
            const mode = Project.display_settings && Project.display_settings[key];
            if (!mode || !mode.export) continue;
            const entry = {};
            if (mode.rotation)    entry.rotation    = mode.rotation;
            if (mode.translation) entry.translation = mode.translation;
            if (mode.scale)       entry.scale       = mode.scale;
            if (Object.keys(entry).length) display[key] = entry;
          }
          if (Object.keys(display).length) model.display = display;

          return compactArrays(JSON.stringify(model, null, 2));
        }
      });

      // ── Format ───────────────────────────────────────────────────────────
      const format = new ModelFormat('keldaria_baked', {
        name: "Keldaria Baked",
        show_on_start_screen: true,
        cullfaces: true,
        box_uv: false,
        texture_folder: true,
        single_texture: false,
        per_texture_uv_size: true,
        model_identifier: false,
        rotate_cubes: true,
        rotation_limit: false,
        uv_rotation: true,
        java_face_properties: true,
        java_cube_shading_properties: true,
        parent_model_id: true,
        display_mode: true,
        icon: 'cube',
        codec,
        onStart() {}
      });

      // ── Panel Shader IDs ─────────────────────────────────────────────────
      const shaderPanel = new Panel('keldaria_shader_panel', {
        name: 'Keldaria – Shader IDs',
        icon: 'blur_on',
        display_condition: {
          formats: ['keldaria_baked'],
        },
        default_side: 'right',
        component: {
          data() {
            return {
              cube: null,
              ids: [0, 0, 0, 0, 0, 0, 0, 0],
            };
          },
          methods: {
            refresh() {
              const sel = Blockbench.getSelection
                ? Blockbench.getSelection()
                : (typeof selected !== 'undefined' ? selected : []);
              const cubes = sel.filter(e => e instanceof Cube);
              if (cubes.length === 1) {
                this.cube = cubes[0];
                this.ids  = [...(this.cube.keldaria_shader_ids || [0,0,0,0,0,0,0,0])];
              } else {
                this.cube = null;
                this.ids  = [0, 0, 0, 0, 0, 0, 0, 0];
              }
            },
            update(index) {
              if (!this.cube) return;
              const val = parseInt(this.ids[index]) || 0;
              this.ids[index] = val;
              if (!this.cube.keldaria_shader_ids) {
                this.cube.keldaria_shader_ids = [0,0,0,0,0,0,0,0];
              }
              // Wrap dans un Undo pour que l'action soit annulable
              Undo.initEdit({ elements: [this.cube] });
              this.cube.keldaria_shader_ids = [...this.ids];
              Undo.finishEdit('Set Shader ID');
            },
            // Applique le même shader ID à tous les vertices du cube
            applyAll(val) {
              if (!this.cube) return;
              const v = parseInt(val) || 0;
              this.ids = [v,v,v,v,v,v,v,v];
              Undo.initEdit({ elements: [this.cube] });
              this.cube.keldaria_shader_ids = [...this.ids];
              Undo.finishEdit('Set Shader ID (all vertices)');
            },
          },
          template: `
            <div style="padding: 8px;">

              <p v-if="!cube" style="opacity:.5; font-style:italic; text-align:center; margin:12px 0;">
                Sélectionne un seul cube
              </p>

              <template v-if="cube">

                <!-- Bouton "tout mettre à la même valeur" -->
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px;">
                  <label style="flex:1; font-size:11px; opacity:.7;">Tous les vertices :</label>
                  <input
                    type="number" min="0" step="1"
                    :value="ids[0] === ids[1] && ids[1] === ids[2] && ids[2] === ids[3]
                            && ids[3] === ids[4] && ids[4] === ids[5] && ids[5] === ids[6]
                            && ids[6] === ids[7] ? ids[0] : ''"
                    placeholder="—"
                    @change="applyAll($event.target.value)"
                    style="width:54px; text-align:center;"
                  />
                </div>

                <hr style="opacity:.2; margin-bottom:10px;"/>

                <!-- Couche BOTTOM -->
                <div style="font-size:10px; text-transform:uppercase; opacity:.5; margin-bottom:4px; letter-spacing:.06em;">
                  Bottom (Y–)
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:10px;">
                  <div v-for="i in [0,1,2,3]" :key="i"
                       style="display:flex; flex-direction:column; align-items:center; gap:2px;">
                    <span style="font-size:10px; opacity:.6;">{{ ['NW','NE','SW','SE'][i] }}</span>
                    <input
                      type="number" min="0" step="1"
                      v-model.number="ids[i]"
                      @change="update(i)"
                      style="width:48px; text-align:center;"
                    />
                  </div>
                </div>

                <!-- Couche TOP -->
                <div style="font-size:10px; text-transform:uppercase; opacity:.5; margin-bottom:4px; letter-spacing:.06em;">
                  Top (Y+)
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
                  <div v-for="j in [4,5,6,7]" :key="j"
                       style="display:flex; flex-direction:column; align-items:center; gap:2px;">
                    <span style="font-size:10px; opacity:.6;">{{ ['NW','NE','SW','SE'][j-4] }}</span>
                    <input
                      type="number" min="0" step="1"
                      v-model.number="ids[j]"
                      @change="update(j)"
                      style="width:48px; text-align:center;"
                    />
                  </div>
                </div>

              </template>
            </div>
          `,
          mounted() {
            this.refresh();
            // Rafraîchit le panel à chaque changement de sélection
            this._onSelect = () => this.refresh();
            Blockbench.on('update_selection', this._onSelect);
            Blockbench.on('select_all',       this._onSelect);
          },
          beforeDestroy() {
            Blockbench.removeListener('update_selection', this._onSelect);
            Blockbench.removeListener('select_all',       this._onSelect);
          },
        },
      });

      // ── Action d'ouverture dédiée ─────────────────────────────────────────
      const openAction = new Action('open_keldaria_model', {
        name: 'Open Keldaria Model…',
        description: 'Ouvrir un fichier Keldaria BakedModel (.json)',
        icon: 'folder_open',
        click() {
          Blockbench.import(
            { extensions: ['json'], type: 'Keldaria Baked Model' },
            (files) => {
              files.forEach(file => {
                let model;
                try {
                  model = JSON.parse(file.content);
                } catch (e) {
                  Blockbench.showStatusMessage('Erreur : JSON invalide.', 3000);
                  return;
                }
                if (!model.parts || model.elements) {
                  Blockbench.showStatusMessage(
                    "Ce fichier n'est pas reconnu comme un modèle Keldaria.", 4000
                  );
                  return;
                }
                newProject(format);
                codec.parse(model, file.path);
              });
            }
          );
        }
      });

      MenuBar.menus.file.addAction(openAction, '#open_model');
    },

    onunload() {
      MenuBar.menus.file.removeAction('open_keldaria_model');
    }
  });

})();
