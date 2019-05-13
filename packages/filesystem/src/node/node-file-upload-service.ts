/********************************************************************************
 * Copyright (C) 2019 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

// tslint:disable-next-line
import * as ws from 'ws';
import { injectable } from 'inversify';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { MessagingService } from '@theia/core/lib/node/messaging/messaging-service';
import { NodeFileUpload } from './node-file-upload';

@injectable()
export class NodeFileUploadService implements MessagingService.Contribution {

    static wsPath = '/file-upload';

    configure(service: MessagingService): void {
        service.ws(NodeFileUploadService.wsPath, (_, socket) => this.handleFileUpload(socket));
    }

    protected handleFileUpload(socket: ws): void {
        let total = 0;
        let done = 0;
        let upload: NodeFileUpload | undefined;
        let queue = Promise.resolve();
        socket.on('message', data => queue = queue.then(async () => {
            try {
                if (upload) {
                    await upload.append(data as ArrayBuffer);
                    if (upload.uploadedBytes >= upload.size) {
                        done += upload.size;
                        await upload.rename();
                        upload = undefined;
                    }
                    if (socket.readyState !== 1) {
                        return;
                    }
                    const uploadedBytes = done + (upload ? upload.uploadedBytes : 0);
                    if (uploadedBytes < total) {
                        socket.send(JSON.stringify({
                            done: uploadedBytes
                        }));
                    } else {
                        socket.send(JSON.stringify({ ok: true }));
                        socket.close();
                    }
                    return;
                }
                const request = JSON.parse(data.toString());
                if (request.total) {
                    total = request.total;
                    return;
                }
                if (request.uri) {
                    upload = new NodeFileUpload(FileUri.fsPath(request.uri), request.size);
                    await upload.create();
                    if (!upload.size) {
                        await upload.rename();
                        upload = undefined;
                    }
                    return;
                }
                console.error('unknown upload request', data);
                throw new Error('unknown upload request, see backend logs');
            } catch (e) {
                console.error(e);
                if (socket.readyState === 1) {
                    socket.send(JSON.stringify({
                        error: 'upload failed (see backend logs for details), reason: ' + e.message
                    }));
                    socket.close();
                }
            }
        }));
        socket.on('error', console.error);
        socket.on('close', () => {
            if (upload) {
                upload.dispose();
            }
        });
    }

}
