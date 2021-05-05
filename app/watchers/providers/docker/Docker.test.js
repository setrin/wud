const { ValidationError } = require('joi');
const Docker = require('./Docker');
const Hub = require('../../../registries/providers/hub/Hub');
const Ecr = require('../../../registries/providers/ecr/Ecr');
const Gcr = require('../../../registries/providers/gcr/Gcr');
const Acr = require('../../../registries/providers/acr/Acr');

const sampleSemver = require('../../samples/semver.json');
const sampleCoercedSemver = require('../../samples/coercedSemver.json');
// const sampleNotSemver = require('../../samples/notSemver.json');

jest.mock('request-promise-native');

const docker = new Docker();
const hub = new Hub();
const ecr = new Ecr();
const gcr = new Gcr();
const acr = new Acr();

Docker.__set__('getRegistries', () => ({
    ecr,
    gcr,
    hub,
    acr,
}));

Docker.__set__('getWatchImageGauge', () => ({ set: () => {} }));

const configurationValid = {
    socket: '/var/run/docker.sock',
    port: 2375,
    watchbydefault: true,
    watchall: false,
    cron: '0 * * * *',
};

test('validatedConfiguration should initialize when configuration is valid', () => {
    const validatedConfiguration = docker.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validatedConfiguration should initialize with default values when not provided', () => {
    const validatedConfiguration = docker.validateConfiguration({});
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validatedConfiguration should failed when configuration is invalid', () => {
    expect(() => {
        docker.validateConfiguration({ watchbydefault: 'xxx' });
    }).toThrowError(ValidationError);
});

test('initTrigger should create a configured DockerApi instance', () => {
    docker.configuration = docker.validateConfiguration(configurationValid);
    docker.initTrigger();
    expect(docker.dockerApi.modem.socketPath).toBe(configurationValid.socket);
});

test('getSemverTagsCandidate should match when current version is semver and new tag is found', () => {
    expect(Docker.__get__('getSemverTagsCandidate')(sampleSemver, ['7.8.9'])).toEqual(['7.8.9']);
});

test('getSemverTagsCandidate should match when current version is coerced semver and new tag is found', () => {
    expect(Docker.__get__('getSemverTagsCandidate')(sampleCoercedSemver, ['7.8.9'])).toEqual(['7.8.9']);
});

test('getSemverTagsCandidate should not match when current version is semver and no new tag is found', () => {
    expect(Docker.__get__('getSemverTagsCandidate')(sampleSemver, [])).toEqual([]);
});

test('getSemverTagsCandidate should match when newer version match the include regex', () => {
    expect(Docker.__get__('getSemverTagsCandidate')({ ...sampleSemver, includeTags: '^[0-9]\\d*\\.[0-9]\\d*\\.[0-9]\\d*$' }, ['7.8.9'])).toEqual(['7.8.9']);
});

test('getSemverTagsCandidate should not match when newer version but doesnt match the include regex', () => {
    expect(Docker.__get__('getSemverTagsCandidate')({ ...sampleSemver, includeTags: '^v[0-9]\\d*\\.[0-9]\\d*\\.[0-9]\\d*$' }, ['7.8.9'])).toEqual([]);
});

test('getSemverTagsCandidate should match when newer version doesnt match the exclude regex', () => {
    expect(Docker.__get__('getSemverTagsCandidate')({ ...sampleSemver, excludeTags: '^v[0-9]\\d*\\.[0-9]\\d*\\.[0-9]\\d*$' }, ['7.8.9'])).toEqual(['7.8.9']);
});

test('getSemverTagsCandidate should not match when newer version and match the exclude regex', () => {
    expect(Docker.__get__('getSemverTagsCandidate')({ ...sampleSemver, excludeTags: '^[0-9]\\d*\\.[0-9]\\d*\\.[0-9]\\d*$' }, ['7.8.9'])).toEqual([]);
});

test('getSemverTagsCandidate should return only greater tags than current', () => {
    expect(Docker.__get__('getSemverTagsCandidate')(sampleSemver, ['7.8.9', '4.5.6', '1.2.3'])).toEqual(['7.8.9']);
});

test('getSemverTagsCandidate should return all greater tags', () => {
    expect(Docker.__get__('getSemverTagsCandidate')(sampleSemver, ['10.11.12', '7.8.9', '4.5.6', '1.2.3'])).toEqual(['10.11.12', '7.8.9']);
});

test('getSemverTagsCandidate should return greater tags when digit over 9', () => {
    expect(Docker.__get__('getSemverTagsCandidate')({ tag: '1.9.0', isSemver: true }, ['1.10.0', '1.2.3'])).toEqual(['1.10.0']);
});

test('normalizeImage should return hub when applicable', () => {
    expect(Docker.__get__('normalizeImage')({ image: 'image' })).toStrictEqual({
        registry: 'hub',
        registryUrl: 'https://registry-1.docker.io/v2',
        image: 'library/image',
    });
});

test('normalizeImage should return ecr when applicable', () => {
    expect(Docker.__get__('normalizeImage')({
        registryUrl: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
    })).toStrictEqual({
        registry: 'ecr',
        registryUrl: 'https://123456789.dkr.ecr.eu-west-1.amazonaws.com/v2',
    });
});

test('normalizeImage should return gcr when applicable', () => {
    expect(Docker.__get__('normalizeImage')({
        registryUrl: 'us.gcr.io',
    })).toStrictEqual({
        registry: 'gcr',
        registryUrl: 'https://us.gcr.io/v2',
    });
});

test('normalizeImage should return acr when applicable', () => {
    expect(Docker.__get__('normalizeImage')({
        registryUrl: 'test.azurecr.io',
    })).toStrictEqual({
        registry: 'acr',
        registryUrl: 'https://test.azurecr.io/v2',
    });
});

test('normalizeImage should return original image when no matching provider found', () => {
    expect(Docker.__get__('normalizeImage')({ registryUrl: 'xxx' })).toEqual({ registryUrl: 'xxx', registry: 'unknown' });
});

test('findNewVersion should return new image when found', async () => {
    hub.getTags = () => ({
        tags: ['7.8.9'],
    });
    await expect(docker.findNewVersion(sampleSemver)).resolves.toMatchObject({
        tag: '7.8.9',
        digest: undefined,
    });
});

test('findNewVersion should return empty result when no image found', async () => {
    hub.getTags = () => ({
        tags: [],
    });
    await expect(docker.findNewVersion(sampleSemver)).resolves.toMatchObject({
        tag: undefined,
        digest: undefined,
    });
});

test('mapContainerToImage should map a container definition to an image definition', async () => {
    docker.dockerApi = {
        getImage: () => ({
            inspect: () => ({
                Architecture: 'arch',
                Os: 'os',
                Size: '10',
                Created: '2019-05-20T12:02:06.307Z',
                Config: {
                    Image: 'sha256:2256fd5ac3e1079566f65cc9b34dc2b8a1b0e0e1bb393d603f39d0e22debb6ba',
                },
            }),
        }),
    };
    const container = {
        Image: 'organization/image:version',
    };

    const image = await docker.mapContainerToImage(container);
    expect(image).toMatchObject({
        registry: 'hub',
        registryUrl: 'https://registry-1.docker.io/v2',
        image: 'organization/image',
        tag: 'version',
        versionDate: '2019-05-20T12:02:06.307Z',
        architecture: 'arch',
        os: 'os',
        size: '10',
        includeTags: undefined,
        excludeTags: undefined,
    });
});

test('watchImage should return new image when found', () => {
    docker.configuration = {};
    hub.getTags = () => ({
        tags: ['7.8.9'],
    });
    expect(docker.watchImage(sampleSemver)).resolves.toMatchObject({
        result: {
            tag: '7.8.9',
        },
    });
});

test('watchImage should return no result when no image found', async () => {
    docker.configuration = {};
    hub.getTags = () => ({
        tags: [],
    });
    await expect(docker.watchImage(sampleSemver)).resolves.toMatchObject({
        result: {
            tag: undefined,
            digest: undefined,
        },
    });
});
test('watch should return a list of images found by the docker socket', async () => {
    const image1 = {
        Image: 'image',
        Architecture: 'arch',
        Os: 'os',
        Size: '10',
        Created: '2019-05-20T12:02:06.307Z',
        Labels: {},
        Config: {
            Image: 'sha256:2256fd5ac3e1079566f65cc9b34dc2b8a1b0e0e1bb393d603f39d0e22debb6ba',
        },
    };
    docker.dockerApi = {
        listContainers: () => ([image1]),
        getImage: () => ({
            inspect: () => (image1),
        }),
    };

    // Fake conf
    docker.configuration = {
        watchbydefault: true,
    };

    await expect(docker.watch()).resolves.toMatchObject([{
        registry: 'hub',
        registryUrl: 'https://registry-1.docker.io/v2',
        image: 'library/image',
        tag: 'latest',
        versionDate: '2019-05-20T12:02:06.307Z',
        architecture: 'arch',
        os: 'os',
        size: '10',
        isSemver: false,
    }]);
});

test('pruneOldImages should prune old images', () => {
    const oldImages = [{
        watcher: 'watcher',
        registryUrl: 'registryUrl',
        image: 'image',
        tag: 'version1',
        includeTags: 'includeTags',
        excludeTags: 'excludeTags',
    }, {
        watcher: 'watcher',
        registryUrl: 'registryUrl',
        image: 'image',
        tag: 'version2',
        includeTags: 'includeTags',
        excludeTags: 'excludeTags',
    }];
    const newImages = [{
        watcher: 'watcher',
        registryUrl: 'registryUrl',
        image: 'image',
        tag: 'version2',
        includeTags: 'includeTags',
        excludeTags: 'excludeTags',
    }];
    expect(Docker.__get__('getOldImages')(newImages, oldImages)).toEqual([{
        watcher: 'watcher',
        registryUrl: 'registryUrl',
        image: 'image',
        tag: 'version1',
        includeTags: 'includeTags',
        excludeTags: 'excludeTags',
    }]);
});

test('pruneOldImages should operate when lists are empty or undefined', () => {
    expect(Docker.__get__('getOldImages')([], [])).toEqual([]);
    expect(Docker.__get__('getOldImages')(undefined, undefined)).toEqual([]);
});
